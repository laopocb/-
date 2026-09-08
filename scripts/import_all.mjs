/**
 * import_all.mjs —— 把 data/全部.geojson 全部点位一次性导入官方注解（settings.json）
 * ------------------------------------------------------------------------------
 * 坐标：全部.geojson 为本地数据坐标系（与 lx.geojson 同源），
 *       数据→世界 变换：世界 = (x, z, -y)（同 polygon-layer 的挤出变换）。
 * 图片：第 n 个点 → data/点位/A{n}.jpg（存在才用，否则统一退回 A1.jpg）。
 * 展示：与 3 号点一致 —— 官方圆点 + 点击浮云框大图（annotations-poster.js 自动适配）。
 * 写入：直接改根 settings.json 的 annotations 数组（保留其余字段），随后 node scripts/build.mjs 生效。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO = join(ROOT, 'data', '全部.geojson');
const SETTINGS = join(ROOT, 'settings.json');
const IMG_DIR = join(ROOT, 'data', '点位');

const gj = JSON.parse(readFileSync(GEO, 'utf8'));
const features = (gj.features || []).filter((f) => f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates));

const annotations = features.map((f, i) => {
    // 本地(px, py, pz) → 世界(px, pz, -py)
    const [px, py, pz] = f.geometry.coordinates;
    const n = i + 1;
    const candidate = `A${n}.jpg`;
    const image = existsSync(join(IMG_DIR, candidate)) ? `点位/${candidate}` : '点位/A1.jpg';
    return {
        position: [Math.round(px * 100) / 100, Math.round(pz * 100) / 100, Math.round(-py * 100) / 100],
        title: f.properties?.title || `展项 ${n}`,
        text: f.properties?.desc || '',
        image
    };
});

const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
settings.annotations = annotations;
writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');

console.log(`已导入 ${annotations.length} 个点位 → settings.json`);
console.log('前 5 个（世界坐标 / 图片）：');
annotations.slice(0, 5).forEach((a) => console.log(`  (${a.position.join(', ')})  <${a.title}>  ${a.image}`));
const fallbackCount = annotations.filter((a) => a.image.endsWith('A1.jpg')).length;
console.log(fallbackCount ? `  有 ${fallbackCount} 个点无对应图片，已退回 A1.jpg` : '  全部点均有对应图片');