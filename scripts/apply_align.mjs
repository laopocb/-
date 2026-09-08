/**
 * apply_align.mjs —— 把高斯→墙系的仿射变换应用到 settings.json 的初始相机（position/target）
 * --------------------------------------------------------------------------------------------
 * 背景：114 个注解导入时已按本地→世界 (x, z, -y) 变换，落在墙系世界范围，无需再变；
 *      高斯数据本体的偏移由 build.mjs 中的实体矩阵补丁完成。
 * 本脚本只需把"初始相机"（当前位于高斯世界系）变换到墙系世界，保证进门视角一致：
 *   toWall(v) = (T.x, T.z, -T.y)，
 *   T = A·v + b（8 组对应点仿射拟合，高斯→墙本地方米）。
 * 用法：node scripts/apply_align.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = join(ROOT, 'settings.json');

const A = [
    [1.1176, 0.2947, 0.2199, 30.4796],
    [-0.0032, -0.0254, -1.0171, 44.6912],
    [-0.0344, 0.9154, -0.0778, 2.8326]
];

// 高斯世界点 → 墙系世界点（world = (T.x, T.z, -T.y)）
const toWall = (v) => {
    const t = [0, 1, 2].map((r) => A[r][0] * v[0] + A[r][1] * v[1] + A[r][2] * v[2] + A[r][3]);
    return [t[0], t[2], -t[1]];
};

const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
const cam = settings.cameras?.[0]?.initial;
if (!cam) {
    console.log('未找到 cameras[0].initial，跳过');
    process.exit(1);
}

const fmtVec = (v) => `(${v.map((n) => n.toFixed(2)).join(', ')})`;
console.log(`初始相机 变换前：position ${fmtVec(cam.position)}  target ${fmtVec(cam.target)}`);
cam.position = toWall(cam.position).map((n) => Math.round(n * 100) / 100);
cam.target = toWall(cam.target).map((n) => Math.round(n * 100) / 100);
console.log(`初始相机 变换后：position ${fmtVec(cam.position)}  target ${fmtVec(cam.target)}`);
writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');

// 输出供 build.mjs 使用的高斯实体矩阵（row-major 16）
const MR = [A[0][0], A[0][1], A[0][2], A[0][3], A[2][0], A[2][1], A[2][2], A[2][3], -A[1][0], -A[1][1], -A[1][2], -A[1][3], 0, 0, 0, 1];
console.log('\n高斯实体矩阵（world→墙系，row-major，填入 build.mjs 对齐补丁）：');
console.log('[' + MR.map((n) => n.toFixed(4)).join(',') + ']');
console.log('验证 Q(-9.41,-1.12,18.49) → ' + fmtVec(toWall([-9.41, -1.12, 18.49])) + '（期望约 (23.29, 0.66, -25.84)）');