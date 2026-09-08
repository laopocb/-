/**
 * kml_to_annotations.mjs —— 以 KML（权威源）生成页面标注点
 * -------------------------------------------------------------------------------
 * 桥接：KML→页面 轴语义 = (x, z, -y)，平移锚定于 1_点/4_点（用户 8 组中最自洽两点，
 * 残差 <0.15m；其余 6 组与 KML 平面差 2~28m，判定为离群/编号错位，依用户要求弃用）。
 * 高度带与页面吻合 → 尺度≈1，仅需平移。
 * 用法：node scripts/kml_to_annotations.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KML_PATH = join(ROOT, 'data', '标注.kml');
const SETTINGS = join(ROOT, 'settings.json');
const IMG_DIR = join(ROOT, 'data', '点位');

// 锚点对：KML name → 用户确认的页面坐标（点 1 / 点 4）
const ANCHORS = {
    '1_点': [11.52, 0.70, 24.25],
    '4_点': [-7.39, 1.23, 23.13]
};
const mapW = (K) => [K[0], K[2], -K[1]];
const dsum = [0, 0, 0];
// —— 实际流程：解析 KML —
const text = readFileSync(KML_PATH, 'utf8');
const kml = {};
const placeBlocks = [...text.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].map((m) => m[1]);
for (const b of placeBlocks) {
    const n = b.match(/<name>([^<]*)<\/name>/)?.[1]?.trim();
    const c = b.match(/<coordinates>\s*([^<]+?)\s*<\/coordinates>/)?.[1]?.trim();
    if (!n || !c) continue;
    const v = c.split(',').map(Number);
    if (v.length >= 3 && v.every(Number.isFinite)) kml[n] = v;
}
console.log(`KML 解析点数: ${Object.keys(kml).length}`);
// 计算锚点平移
for (const [name, q] of Object.entries(ANCHORS)) {
    const K = kml[name];
    if (!K) { console.error(`锚点 ${name} 在 KML 中不存在`); process.exit(1); }
    const w = mapW(K);
    [0, 1, 2].forEach((i) => (dsum[i] += (q[i] - w[i]) / Object.keys(ANCHORS).length));
}
console.log('锚点平移 t =', dsum.map((v) => v.toFixed(3)).join(', '));

// 生成 114 个注解（按 KML 顺序：name 排序/文件顺序）
const names = placeBlocks
    .map((b) => b.match(/<name>([^<]*)<\/name>/)?.[1]?.trim())
    .filter(Boolean);
const annotations = names.map((name, i) => {
    const K = kml[name];
    if (!K) { console.error(`缺少坐标: ${name}`); process.exit(1); }
    const w = mapW(K);
    const position = w.map((v, i2) => Math.round((v + dsum[i2]) * 100) / 100);
    const n = i + 1;
    const file = join(IMG_DIR, `A${n}.jpg`);
    const image = existsSync(file) ? `点位/A${n}.jpg` : '点位/A1.jpg';
    return { position, title: name, text: '', image };
});

const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
settings.annotations = annotations;
writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');
console.log(`已写入 ${annotations.length} 个注解（KML 权威源 + 锚点平移）`);
annotations.slice(0, 5).forEach((a) => console.log(`  ${a.title}: (${a.position.join(', ')}) img=${a.image}`));
const init = settings.cameras[0].initial;
console.log('初始相机未动:', JSON.stringify(init.position));