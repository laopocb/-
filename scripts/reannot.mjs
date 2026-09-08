/**
 * reannot.mjs —— 将 data/全部.geojson（114 个点位）按空气墙同一轴对齐校正重导到 settings.annotations
 * -----------------------------------------------------------------------------------------------
 * 管道：本地 p=(px, py, ele) → 墙系世界 base=(px, ele, -py) → 高斯世界 S*base+T
 *   其中 S/T 与 wall-layer / 1.collision.glb 完全一致（8 组对应点轴对齐拟合，RMS 0.21m），
 *   从而注解点位与空气墙、高斯数据同源贴合。
 * 用法：node scripts/reannot.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO = join(ROOT, 'data', '全部.geojson');
const SETTINGS = join(ROOT, 'settings.json');
const IMG_DIR = join(ROOT, 'data', '点位');

const S = [1.0075, 1.0066, 1.0074];
const T = [-33.5832, -1.8542, 44.6125];

const geojson = JSON.parse(readFileSync(GEO, 'utf8'));
const points = geojson.features
    .filter((f) => f.geometry && f.geometry.type === 'Point')
    .map((f) => f.geometry.coordinates);

const annotations = points.map((p, i) => {
    const base = [p[0], p[2], -p[1]]; // (px, ele, -py)
    const world = [0, 1, 2].map((k) => (S[k] * base[k] + T[k]).toFixed(2)).map(Number);
    // 图片映射：A{n}.jpg 存在则用（n = 序号+1），否则退回 A1.jpg
    const n = i + 1;
    const file = join(IMG_DIR, `A${n}.jpg`);
    const image = existsSync(file) ? `点位/A${n}.jpg` : '点位/A1.jpg';
    return {
        position: world,
        title: `展项${n}`,
        text: '',
        image
    };
});

const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
settings.annotations = annotations;
writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');

console.log(`已重导 ${annotations.length} 个注解（轴对齐校正 S/T，与空气墙同源）`);
console.log('首3个：');
annotations.slice(0, 3).forEach((a) => console.log(`  ${a.title}: (${a.position.join(', ')}) img=${a.image}`));
const xs = annotations.map((a) => a.position[0]);
const ys = annotations.map((a) => a.position[1]);
const zs = annotations.map((a) => a.position[2]);
console.log(`范围 x=[${Math.min(...xs).toFixed(1)},${Math.max(...xs).toFixed(1)}] y=[${Math.min(...ys).toFixed(1)},${Math.max(...ys).toFixed(1)}] z=[${Math.min(...zs).toFixed(1)},${Math.max(...zs).toFixed(1)}]`);