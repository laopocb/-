/**
 * build_obj_collision.mjs —— 把 1.obj 空气墙生成为 viewer 碰撞体 GLB（data/1.collision.glb）
 * ------------------------------------------------------------------------------------------
 * 坐标系：obj ÷100（墙系世界）→ 逆仿射 B·w+c（高斯世界），与 wall-layer 渲染一致；
 * 三角化：所有多边形 fan 成三角形；
 * 输出：glTF 2.0 二进制（单 buffer：POSITION Float32 + indices Uint32），
 *       viewer 的 MeshCollision 加载器可直接使用（参照官方 collision.glb 结构）。
 * 用法：node scripts/build_obj_collision.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OBJ = join(ROOT, 'data', '1.obj');
const OUT = join(ROOT, 'data', '1.collision.glb');

// 对齐：MAX 坐标(obj/100) → 高斯世界，纯平移 + 每轴独立缩放（零旋转，保持模型水平）
// 常量：7 组手工校对对应点最小二乘拟合（三维 RMS 0.14m）
const S = [1.0075, 1.0066, 1.0074];
const T = [-33.5832, -1.8542, 44.6125];
const toGauss = (w) => [0, 1, 2].map((i) => S[i] * w[i] + T[i]);

const text = readFileSync(OBJ, 'utf8');
const verts = [], polys = [];
text.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (t.startsWith('v ')) {
        const p = t.split(/\s+/).slice(1, 4).map(Number);
        if (p.length === 3 && p.every(Number.isFinite)) verts.push(p);
    } else if (t.startsWith('f ')) {
        const idx = t.split(/\s+/).slice(1).map((s) => parseInt(s.split('/')[0], 10)).filter((n) => Number.isFinite(n) && n !== 0);
        if (idx.length >= 3) polys.push(idx.map((n) => (n > 0 ? n - 1 : verts.length + n)));
    }
});

// 顶点 → 高斯世界 (float32)
const positions = new Float32Array(verts.length * 3);
verts.forEach((p, i) => {
    const g = toGauss([p[0] / 100, p[1] / 100, p[2] / 100]);
    positions[i * 3] = g[0]; positions[i * 3 + 1] = g[1]; positions[i * 3 + 2] = g[2];
});

// 三角化（fan）→ indices uint32
const indices = [];
polys.forEach((poly) => {
    for (let i = 1; i < poly.length - 1; i++) indices.push(poly[0], poly[i], poly[i + 1]);
});
const indexArr = new Uint32Array(indices);

// glTF 2.0 二进制
const posBytes = positions.byteLength, idxBytes = indexArr.byteLength;
const json = {
    asset: { version: '2.0', generator: 'obj-collision-builder' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
        {
            bufferView: 0, componentType: 5126, count: verts.length, type: 'VEC3',
            min: [Math.min(...Array.from({ length: verts.length }, (_, i) => positions[i * 3])), Math.min(...Array.from({ length: verts.length }, (_, i) => positions[i * 3 + 1])), Math.min(...Array.from({ length: verts.length }, (_, i) => positions[i * 3 + 2]))],
            max: [Math.max(...Array.from({ length: verts.length }, (_, i) => positions[i * 3])), Math.max(...Array.from({ length: verts.length }, (_, i) => positions[i * 3 + 1])), Math.max(...Array.from({ length: verts.length }, (_, i) => positions[i * 3 + 2]))]
        },
        { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' }
    ],
    bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
        { buffer: 0, byteOffset: posBytes, byteLength: idxBytes, target: 34963 }
    ],
    buffers: [{ byteLength: posBytes + idxBytes }]
};
let jsonStr = JSON.stringify(json);
while (jsonStr.length % 4 !== 0) jsonStr += ' ';

const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indexArr.buffer)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546C67, 0); // 'glTF'
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonStr.length + 8 + bin.length, 8);
const jc = Buffer.alloc(8);
jc.writeUInt32LE(jsonStr.length, 0); jc.writeUInt32LE(0x4E4F534A, 4); // 'JSON'
const bc = Buffer.alloc(8);
bc.writeUInt32LE(bin.length, 0); bc.writeUInt32LE(0x004E4942, 4); // 'BIN\0'

writeFileSync(OUT, Buffer.concat([header, jc, Buffer.from(jsonStr, 'utf8'), bc, bin]));

console.log(`已生成 ${OUT}`);
console.log(`  顶点 ${verts.length} / 三角形 ${indices.length / 3} / 碰撞网格 (高斯世界系)`);
console.log(`  世界范围 min=(${Math.min(...Array.from({ length: verts.length }, (_, i) => positions[i * 3])).toFixed(2)}, ${Math.min(...Array.from({ length: verts.length }, (_, i) => positions[i * 3 + 1])).toFixed(2)}, ${Math.min(...Array.from({ length: verts.length }, (_, i) => positions[i * 3 + 2])).toFixed(2)})`);
console.log(`  glb 大小 ${(Buffer.concat([header, jc, Buffer.from(jsonStr, 'utf8'), bc, bin]).length / 1024).toFixed(1)} KB`);