/**
 * check_annotations.mjs —— 诊断注解点为何不显示
 * ----------------------------------------------
 * 复用 probe_voxel 的体素解码，检查：
 *   1. 3 个注解点（settings.json annotations.position）自身是否在 solid 体素里（埋墙）
 *   2. 从给定相机位置（默认出生点）到各注解点的视线：queryRay 的命中点距注解点多远（>0.5 会被遮挡判定隐藏）
 * 用法：node scripts/check_annotations.mjs [camX,camY,camZ]
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

const chk = (node, ix, iy, iz) => {
    const idx = node & 0x00FFFFFF;
    const vx = ix & 3, vy = iy & 3, vz = iz & 3;
    const bit = vz * 16 + vy * 4 + vx;
    if (bit < 32) return ((leafData[idx * 2] >>> 0) >>> bit & 1) === 1;
    return ((leafData[idx * 2 + 1] >>> 0) >>> (bit - 32) & 1) === 1;
};
const isSolid = (ix, iy, iz) => {
    if (ix < 0 || iy < 0 || iz < 0 || ix >= numVoxelsX || iy >= numVoxelsY || iz >= numVoxelsZ) return false;
    const bx = Math.floor(ix / leafSize), by = Math.floor(iy / leafSize), bz = Math.floor(iz / leafSize);
    let ni = 0;
    for (let l = treeDepth - 1; l >= 0; l--) {
        const node = nodes[ni] >>> 0;
        if (node === SOLID_LEAF_MARKER) return true;
        const mask = (node >>> 24) & 0xFF;
        if (mask === 0) return chk(node, ix, iy, iz);
        const oct = (((bz >>> l) & 1) << 2) | (((by >>> l) & 1) << 1) | ((bx >>> l) & 1);
        if ((mask & (1 << oct)) === 0) return false;
        ni = (node & 0x00FFFFFF) + popcount(mask & ((1 << oct) - 1));
    }
    const node = nodes[ni] >>> 0;
    if (node === SOLID_LEAF_MARKER) return true;
    return chk(node, ix, iy, iz);
};
const solidAt = (x, y, z) => {
    const ix = Math.floor((x - gridBounds.min[0]) / res);
    const iy = Math.floor((y - gridBounds.min[1]) / res);
    const iz = Math.floor((z - gridBounds.min[2]) / res);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= numVoxelsX || iy >= numVoxelsY || iz >= numVoxelsZ) return { inGrid: false, solid: false };
    return { inGrid: true, solid: isSolid(ix, iy, iz) };
};
// 射线：返回 { hit, t } 或 null（DDA，同 viewer 逻辑）
const raycast = (ox, oy, oz, dx, dy, dz, maxDist) => {
    const eps = 1e-12;
    let tNear = 0, tFar = maxDist;
    const axes = [[dx, gridBounds.min[0], gridBounds.max[0], 0], [dy, gridBounds.min[1], gridBounds.max[1], 1], [dz, gridBounds.min[2], gridBounds.max[2], 2]];
    for (const [d, mn, mx] of axes) {
        if (Math.abs(d) > eps) {
            let t1 = (mn - ox) / d, t2 = (mx - ox) / d;
            if (t1 > t2) [t1, t2] = [t2, t1];
            tNear = Math.max(tNear, t1);
            tFar = Math.min(tFar, t2);
            if (tNear > tFar) return null;
        }
    }
    const entryX = ox + dx * tNear, entryY = oy + dy * tNear, entryZ = oz + dz * tNear;
    let ix = Math.max(0, Math.min(Math.floor((entryX - gridBounds.min[0]) / res), numVoxelsX - 1));
    let iy = Math.max(0, Math.min(Math.floor((entryY - gridBounds.min[1]) / res), numVoxelsY - 1));
    let iz = Math.max(0, Math.min(Math.floor((entryZ - gridBounds.min[2]) / res), numVoxelsZ - 1));
    const sX = dx > 0 ? 1 : (dx < 0 ? -1 : 0), sY = dy > 0 ? 1 : (dy < 0 ? -1 : 0), sZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
    const inv = (v) => Math.abs(v) > eps ? 1 / v : 0;
    const iDX = inv(dx), iDY = inv(dy), iDZ = inv(dz);
    let tMX = Math.abs(dx) > eps ? (gridBounds.min[0] + (ix + (dx > 0 ? 1 : 0)) * res - ox) * iDX : Infinity;
    let tMY = Math.abs(dy) > eps ? (gridBounds.min[1] + (iy + (dy > 0 ? 1 : 0)) * res - oy) * iDY : Infinity;
    let tMZ = Math.abs(dz) > eps ? (gridBounds.min[2] + (iz + (dz > 0 ? 1 : 0)) * res - oz) * iDZ : Infinity;
    const tDX = Math.abs(dx) > eps ? res * Math.abs(iDX) : Infinity;
    const tDY = Math.abs(dy) > eps ? res * Math.abs(iDY) : Infinity;
    const tDZ = Math.abs(dz) > eps ? res * Math.abs(iDZ) : Infinity;
    let t = tNear;
    for (let s = 0; s < numVoxelsX + numVoxelsY + numVoxelsZ; s++) {
        if (isSolid(ix, iy, iz)) return { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, t };
        if (tMX < tMY) {
            if (tMX < tMZ) { t = tMX; ix += sX; tMX += tDX; }
            else { t = tMZ; iz += sZ; tMZ += tDZ; }
        } else if (tMY < tMZ) { t = tMY; iy += sY; tMY += tDY; }
        else { t = tMZ; iz += sZ; tMZ += tDZ; }
        if (ix < 0 || iy < 0 || iz < 0 || ix >= numVoxelsX || iy >= numVoxelsY || iz >= numVoxelsZ) return null;
    }
    return null;
};

const anns = JSON.parse(readFileSync(join(ROOT, 'settings.json'), 'utf8')).annotations;
const cam = (process.argv[2] || '17.22,-0.07,0.87').split(',').map(Number);
console.log(`相机: (${cam.map(n => n.toFixed(2)).join(', ')})`);

// 最近空腔点搜索：沿 26 方向（6轴+12边+8角）步进 0.15m，找首个 free 点
const DIRS = [];
for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
    if (dx === 0 && dy === 0 && dz === 0) continue;
    const len = Math.hypot(dx, dy, dz);
    DIRS.push([dx / len, dy / len, dz / len]);
}
const nearestFree = (x, y, z) => {
    // 先试自身
    if (solidAt(x, y, z).inGrid && !solidAt(x, y, z).solid) return [x, y, z];
    for (let d = 0.15; d <= 2.0; d += 0.15) {
        for (const [ux, uy, uz] of DIRS) {
            const nx = x + ux * d, ny = y + uy * d, nz = z + uz * d;
            const s = solidAt(nx, ny, nz);
            if (s.inGrid && !s.solid) return [nx, ny, nz];
        }
    }
    return null;
};

anns.forEach((a, i) => {
    const p = a.position;
    const s = solidAt(p[0], p[1], p[2]);
    console.log(`\n注解${i + 1}「${a.title}」@(${p.map(n => n.toFixed(2)).join(', ')})`);
    console.log(`  自身在体素内: ${s.inGrid ? (s.solid ? 'SOLID（埋在实心墙里!）' : '空腔（正常）') : '越界'}`);
    if (s.solid) {
        const nf = nearestFree(p[0], p[1], p[2]);
        console.log(`  ★ 建议坐标（最近空腔点）: ${nf ? `(${nf.map(n => n.toFixed(2)).join(', ')})` : '未找到（<2m 内无空腔）'}`);
    }
    const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2];
    const dd = Math.hypot(dx, dy, dz);
    const h = raycast(cam[0], cam[1], cam[2], dx, dy, dz, dd);
    if (h) {
        const hd = Math.hypot(h.x - p[0], h.y - p[1], h.z - p[2]);
        console.log(`  视线命中体素: 命中点距注解 ${hd.toFixed(2)}m ${hd > 0.5 ? '→ 会被遮挡判定隐藏' : '→ 贴墙，可见'}`);
    } else {
        console.log('  视线无命中（全程空/未达）→ 可见');
    }
});

// 搜索模式：node scripts/check_annotations.mjs <camX,camY,camZ> search
if (process.argv[3] === 'search') {
    const occ = (px, py, pz) => {
        const s = solidAt(px, py, pz);
        if (!s.inGrid || s.solid) return false;
        const dx = px - cam[0], dy = py - cam[1], dz = pz - cam[2];
        const dd = Math.hypot(dx, dy, dz);
        if (dd < 1) return true;
        const hit = raycast(cam[0], cam[1], cam[2], dx, dy, dz, dd);
        if (!hit) return true;
        const hd = Math.hypot(hit.x - px, hit.y - py, hit.z - pz);
        return hd <= 0.5;
    };
    console.log('\n=== 门口视角可见的空腔点搜索（右侧中远景墙区域） ===');
    const found = [];
    for (let z = 4; z <= 26; z += 2) {
        for (let x = 4; x <= 26; x += 2) {
            for (let y = 1.0; y <= 1.8; y += 0.4) {
                if (occ(x, y, z)) found.push({ x, y, z, d: Math.hypot(x - cam[0], y - cam[1], z - cam[2]) });
            }
        }
    }
    found.sort((a, b) => b.d - a.d);
    found.slice(0, 30).forEach(f => console.log(`  (${f.x.toFixed(1)}, ${f.y.toFixed(1)}, ${f.z.toFixed(1)})  门口距离 ${f.d.toFixed(1)}m`));
    if (!found.length) console.log('  （门口视角无可视空腔点）');
}