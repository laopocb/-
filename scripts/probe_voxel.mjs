/**
 * probe_voxel.mjs —— 体素碰撞探针（诊断"为什么在这里被撞"）
 * ------------------------------------------------------------
 * 直接解码 data/point_wlbwg.voxel.json + .voxel.bin（splat-transform 格式，
 * 稀疏八叉树，version 1.1 无坐标翻转），复刻 viewer 的 isVoxelSolid 逻辑，
 * 对指定世界坐标/射线做采样，输出每个采样点 solid/free。
 *
 * 用法：
 *   node scripts/probe_voxel.mjs
 *   node scripts/probe_voxel.mjs 7.40,-0.33,11.50 0.97,0.21,19.14
 *   （不传参数则使用默认：起点 pos、终点 target，可传第二个参数换终点）
 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(readFileSync(join(ROOT, 'data', 'point_wlbwg.voxel.json'), 'utf8'));

const buf = readFileSync(join(ROOT, 'data', 'point_wlbwg.voxel.bin'));
const view = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
const nodes = view.slice(0, metadata.nodeCount);
const leafData = view.slice(metadata.nodeCount, metadata.nodeCount + metadata.leafDataCount);

const { gridBounds, voxelResolution: res, leafSize, treeDepth } = metadata;
const numVoxelsX = Math.round((gridBounds.max[0] - gridBounds.min[0]) / res);
const numVoxelsY = Math.round((gridBounds.max[1] - gridBounds.min[1]) / res);
const numVoxelsZ = Math.round((gridBounds.max[2] - gridBounds.min[2]) / res);
const SOLID_LEAF_MARKER = 0xFF000000 >>> 0;
const popcount = (v) => { v = (v & 0x55555555) + ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); v = (v & 0x0f0f0f0f) + ((v >>> 4) & 0x0f0f0f0f); return (v * 0x01010101) >>> 24; };

function checkLeafByIndex(node, ix, iy, iz) {
    const idx = node & 0x00FFFFFF;
    const vx = ix & 3, vy = iy & 3, vz = iz & 3;
    const bit = vz * 16 + vy * 4 + vx;
    if (bit < 32) return ((leafData[idx * 2] >>> 0) >>> bit & 1) === 1;
    return ((leafData[idx * 2 + 1] >>> 0) >>> (bit - 32) & 1) === 1;
}

function isSolid(ix, iy, iz) {
    if (nodes.length === 0 || ix < 0 || iy < 0 || iz < 0 ||
        ix >= numVoxelsX || iy >= numVoxelsY || iz >= numVoxelsZ) {
        return false; // 注意：viewer 的 isFreeAt 对越界返回 false（视为不可自由）
    }
    const bx = Math.floor(ix / leafSize), by = Math.floor(iy / leafSize), bz = Math.floor(iz / leafSize);
    let nodeIndex = 0;
    for (let level = treeDepth - 1; level >= 0; level--) {
        const node = nodes[nodeIndex] >>> 0;
        if (node === SOLID_LEAF_MARKER) return true;
        const mask = (node >>> 24) & 0xFF;
        if (mask === 0) return checkLeafByIndex(node, ix, iy, iz);
        const octant = (((bz >>> level) & 1) << 2) | (((by >>> level) & 1) << 1) | ((bx >>> level) & 1);
        if ((mask & (1 << octant)) === 0) return false;
        const base = node & 0x00FFFFFF;
        const prefix = (1 << octant) - 1;
        nodeIndex = base + popcount(mask & prefix);
    }
    const node = nodes[nodeIndex] >>> 0;
    if (node === SOLID_LEAF_MARKER) return true;
    return checkLeafByIndex(node, ix, iy, iz);
}

const free = (x, y, z) => {
    const ix = Math.floor((x - gridBounds.min[0]) / res);
    const iy = Math.floor((y - gridBounds.min[1]) / res);
    const iz = Math.floor((z - gridBounds.min[2]) / res);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= numVoxelsX || iy >= numVoxelsY || iz >= numVoxelsZ) {
        return { inGrid: false, solid: false, free: false };
    }
    const solid = isSolid(ix, iy, iz);
    return { inGrid: true, solid, free: !solid };
};

const fmt = (n) => Number.isFinite(n) ? n.toFixed(2) : 'nan';
const [ax, ay, az] = process.argv[2] ? process.argv[2].split(',').map(Number) : [7.40, -0.33, 11.50];
const [bx, by, bz] = process.argv[3] ? process.argv[3].split(',').map(Number) : [0.97, 0.21, 19.14];

console.log(`网格: min(${gridBounds.min}) max(${gridBounds.max}) 分辨率 ${res}m 深度 ${treeDepth} 节点 ${metadata.nodeCount}`);
console.log('');

const report = (tag, x, y, z) => {
    const r = free(x, y, z);
    console.log(`${tag} (${fmt(x)}, ${fmt(y)}, ${fmt(z)}) -> ${r.inGrid ? (r.free ? 'FREE 空腔' : 'SOLID 实心 ← 这里会被撞') : 'OUT-OF-GRID 越界(视为不可自由)'}`);
    return r.free;
};

const free0 = report('相机 pos', ax, ay, az);
report('目标 target', bx, by, bz);
console.log('');

// 沿视线步进采样（每 0.3m，共 40m）
const dx = bx - ax, dy = by - ay, dz = bz - az;
const len = Math.hypot(dx, dy, dz) || 1;
console.log(`沿视线 pos→target 步进采样（单位方向 (${fmt(dx / len)}, ${fmt(dy / len)}, ${fmt(dz / len)})，总长 ${fmt(len)}m）:`);
let firstSolid = -1;
for (let s = 0; s <= len; s += 0.3) {
    const px = ax + dx / len * s, py = ay + dy / len * s, pz = az + dz / len * s;
    const r = free(px, py, pz);
    if (!r.free) {
        firstSolid = s;
        console.log(`  t=${fmt(s)}m  点(${fmt(px)}, ${fmt(py)}, ${fmt(pz)})  SOLID ← 视线方向第一个实心`);
        break;
    }
}
if (firstSolid < 0) console.log('  视线方向 0..len 全部 FREE，没有碰到实心体素');

// 相机附近 1m 邻域扫描：找到离相机最近的实心体素及相对方向
console.log('');
const steps = Math.ceil(1 / res);
let nearest = null;
for (let k = 0; k <= steps; k++) {
    for (let j = -steps; j <= steps; j++) {
        for (let i = -steps; i <= steps; i++) {
            const px = ax + i * res, py = ay + j * res, pz = az + k * res;
            if (!free(px, py, pz).free) {
                const d = Math.hypot(px - ax, py - ay, pz - az);
                if (!nearest || d < nearest.d) nearest = { d, x: px, y: py, z: pz };
            }
        }
    }
}
if (nearest) {
    console.log(`相机附近 1m 立方内最近实心体素：(${fmt(nearest.x)}, ${fmt(nearest.y)}, ${fmt(nearest.z)})，距离 ${fmt(nearest.d)}m${nearest.d > 0.15 ? ' —— 说明这里是挖空腔体外的"填实"区域（external-fill），不是墙' : ''}`);
} else {
    console.log('相机附近 1m 内没有实心体素');
}
// 六个主轴方向的可活动距离（直到第一个实心）
console.log('');
console.log('相机在 ±X/±Y/±Z 六个方向的可活动距离（碰到实心为止）：');
for (const [dir, sx, sy, sz] of [['+X', 1, 0, 0], ['-X', -1, 0, 0], ['+Y', 0, 1, 0], ['-Y', 0, -1, 0], ['+Z', 0, 0, 1], ['-Z', 0, 0, -1]]) {
    let d = 0;
    for (; d < 12; d += res) {
        const px = ax + sx * d, py = ay + sy * d, pz = az + sz * d;
        const r = free(px, py, pz);
        if (!r.free) break;
    }
    console.log(`  ${dir}: 可走 ${fmt(d)}m${d <= 0.6 ? ' ← 基本贴脸' : ''}${d >= 12 ? '（12m 未碰墙）' : ''}`);
}
console.log('');
console.log(free0 ? '起点 free：碰撞来自行进中被推（墙/填实边界）' : '起点 solid：相机出生/当前点本身就泡在实心里（会被持续推挤）');