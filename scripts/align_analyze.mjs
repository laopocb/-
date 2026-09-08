/**
 * align_analyze.mjs —— 高斯数据 ↔ 空气墙 对齐分析（变形探测 + 最优相似变换求解）
 * -------------------------------------------------------------------------------
 * 数据源自 2.txt（现 8 组）：每组 = 空气墙点 P（本地方米系） + 高斯点 Q（世界系，camlog）。
 * 输出：
 *   1) 距离比离散度（越小越接近等比；对照 6 组时的 σ/μ=7.6%）
 *   2) 逐轴差向量稳定性（x 差恒定 → 该轴仅平移）
 *   3) Umeyama 最优相似变换 T: Q→P（s·R·x + t），逐点残差、RMS、最大残差
 *   4) 空间分布评估
 * 用法：node scripts/align_analyze.mjs
 */

const WALL = [
    [23.288, 25.843, 0.656],
    [25.217, 24.112, 0.324],
    [33.791, 40.113, 7.582],
    [34.911, 38.859, 7.612],
    [26.082, 33.392, 5.097],
    [27.104, 32.206, 5.073],
    [48.834, 37.785, 0.591],
    [41.332, 33.804, 0.625]
];
const GS = [
    [-9.41, -1.12, 18.49],
    [-8.63, -1.24, 20.33],
    [0.57, 5.73, 4.29],
    [1.6, 5.73, 5.5],
    [-7.23, 3.09, 11.17],
    [-6.3, 3.1, 12.35],
    [15.19, -1.27, 6.99],
    [8.19, -1.28, 10.46]
];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a, b) => { const d = sub(a, b); return Math.hypot(d[0], d[1], d[2]); };
const fmt = (n) => Number.isFinite(n) ? n.toFixed(4) : 'nan';
const N = WALL.length;

// ---------- 1) 距离比 ----------
console.log(`========== 距离比 dP/dQ（共 ${N * (N - 1) / 2} 对） ==========`);
const ratios = [];
for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
        const dP = dist(WALL[i], WALL[j]), dQ = dist(GS[i], GS[j]);
        if (dQ > 1e-9) ratios.push(dP / dQ);
    }
}
const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
const std = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length);
console.log(`  距离比：均值=${fmt(mean)}，σ=${fmt(std)}，离散度 σ/μ=${fmt(std / mean)}`);
console.log(`  ${std / mean < 0.005 ? '→ 等比相似：仅统一缩放+旋转+平移（无各轴变形）' : std / mean < 0.05 ? '→ 近似等比：轻微不均（误差级）' : '→ 存在各轴变形/较大误差'}`);
console.log(`  （6 组时 σ/μ≈0.0756，8 组时=${fmt(std / mean)}）`);

// ---------- 2) 逐轴差向量 ----------
console.log('\n========== 逐轴差向量 P-Q ==========');
for (const axis of ['x', 'y', 'z']) {
    const vals = WALL.map((p, i) => p[{ x: 0, y: 1, z: 2 }[axis]] - GS[i][{ x: 0, y: 1, z: 2 }[axis]]);
    const mn = Math.min(...vals), mx = Math.max(...vals);
    console.log(`  ${axis}: [${vals.map(fmt).join(', ')}]  波动范围 ${fmt(mx - mn)}m${mx - mn < 0.5 ? ' ← 该轴近似纯平移' : ''}`);
}

// ---------- 3) Umeyama 最优相似变换 T: Q→P （s·R·x + t） ----------
// 3x3 one-sided Jacobi SVD（右乘旋转，H = U·Σ·Vᵀ）
const svd3 = (A) => {
    const M = A.map((r) => r.slice());
    let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let iter = 0; iter < 96; iter++) {
        let off = 0;
        for (let p = 0; p < 3; p++) {
            for (let q = p + 1; q < 3; q++) {
                let apq = 0, app = 0, aqq = 0;
                for (let i = 0; i < 3; i++) { apq += M[i][p] * M[i][q]; app += M[i][p] * M[i][p]; aqq += M[i][q] * M[i][q]; }
                if (Math.abs(apq) < 1e-14 * (app * aqq + 1)) continue;
                const tau = (aqq - app) / (2 * apq);
                const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
                const c = 1 / Math.sqrt(1 + t * t), s = t * c;
                for (let i = 0; i < 3; i++) {
                    const mip = M[i][p], miq = M[i][q];
                    M[i][p] = c * mip - s * miq;
                    M[i][q] = s * mip + c * miq;
                    const vip = V[i][p], viq = V[i][q];
                    V[i][p] = c * vip - s * viq;
                    V[i][q] = s * vip + c * viq;
                }
                off += apq * apq;
            }
        }
        if (off < 1e-26) break;
    }
    const sv = [0, 1, 2].map((i) => Math.hypot(M[0][i], M[1][i], M[2][i]));
    const U = [0, 1, 2].map((c) => [0, 1, 2].map((i) => M[i][c] / (sv[c] || 1)));
    return { U, S: sv, V };
};

const umeyama = (P, Q) => {
    const n = P.length;
    const muP = [0, 0, 0], muQ = [0, 0, 0];
    P.forEach((p) => { muP[0] += p[0] / n; muP[1] += p[1] / n; muP[2] += p[2] / n; });
    Q.forEach((q) => { muQ[0] += q[0] / n; muQ[1] += q[1] / n; muQ[2] += q[2] / n; });
    let H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let varQ = 0;
    for (let i = 0; i < n; i++) {
        const a = sub(P[i], muP), b = sub(Q[i], muQ);
        varQ += b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r][c] += a[r] * b[c];
    }
    const { U, S, V } = svd3(H);
    // R = U · D · Vᵀ，D = diag(1,1,det(U·Vᵀ))
    const Vt = [0, 1, 2].map((c) => [0, 1, 2].map((r) => V[r][c]));
    let detUV = 0;
    for (let i = 0; i < 3; i++) detUV += U[0][i] * Vt[i][0];
    const detU = U[0][0] * (U[1][1] * U[2][2] - U[1][2] * U[2][1]) - U[0][1] * (U[1][0] * U[2][2] - U[1][2] * U[2][0]) + U[0][2] * (U[1][0] * U[2][1] - U[1][1] * U[2][0]);
    const detV = V[0][0] * (V[1][1] * V[2][2] - V[1][2] * V[2][1]) - V[0][1] * (V[1][0] * V[2][2] - V[1][2] * V[2][0]) + V[0][2] * (V[1][0] * V[2][1] - V[1][1] * V[2][0]);
    const sgnD = Math.sign(detU * detV) || 1;
    const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let k = 0; k < 3; k++) s += U[r][k] * ((k === 2 ? sgnD : 1)) * Vt[k][c];
            R[r][c] = s;
        }
    }
    const sScale = (S[0] + S[1] + sgnD * S[2]) / (varQ || 1);
    const applyR = (v) => [0, 1, 2].map((r) => R[r][0] * v[0] + R[r][1] * v[1] + R[r][2] * v[2]);
    const t = [0, 1, 2].map((k) => muP[k] - sScale * applyR(muQ)[k]);
    return { s: sScale, R, t, apply: (v) => [0, 1, 2].map((k) => sScale * applyR(v)[k] + t[k]) };
};

const sol = umeyama(WALL, GS);
console.log('\n========== Umeyama 最优相似变换 T: 高斯→墙 ==========');
console.log(`  缩放 s = ${fmt(sol.s)}`);
console.log('  旋转 R =');
sol.R.forEach((r) => console.log(`    [${r.map(fmt).join(', ')}]`));
console.log(`  平移 t = [${sol.t.map(fmt).join(', ')}]`);
const res = WALL.map((p, i) => {
    const tq = sol.apply(GS[i]);
    return { d: dist(p, tq), p, tq };
});
res.sort((a, b) => b.d - a.d);
const rms = Math.sqrt(res.reduce((a, x) => a + x.d * x.d, 0) / N);
console.log(`\n  变换残差（T(Q) vs P）：最大 ${fmt(res[0].d)}m，RMS ${fmt(rms)}m`);
res.forEach((x, i) => console.log(`    点${i + 1}: 残差 ${fmt(x.d)}m  P=(${x.p.map(fmt).join(',')})`));
console.log(`  ${rms < 0.05 ? '★ 亚厘米级：相似变换即可精确对齐' : rms < 0.3 ? '★ 分米级：对齐良好（取点误差范畴）' : '★ 残差偏大：需要更准确的对应点或考虑逐轴缩放'}`);

// ---------- 4) 分布评估 ----------
// ---------- 4) 各轴独立缩放仿射拟合（T: Q→P，12 参数，正规方程求解） ----------
console.log('\n========== 各轴独立缩放仿射拟合（若残差远小于相似变换 → 存在各轴变形） ==========');
const solve4 = (A, b) => {
    const M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 4; c++) {
        let piv = c;
        for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        [M[c], M[piv]] = [M[piv], M[c]];
        const d = M[c][c] || 1e-18;
        for (let r = 0; r < 4; r++) {
            if (r === c) continue;
            const f = M[r][c] / d;
            for (let k = c; k <= 4; k++) M[r][k] -= f * M[c][k];
        }
        for (let k = c; k <= 4; k++) M[c][k] /= d;
    }
    return [0, 1, 2, 3].map((i) => M[i][4]);
};
const X = GS.map((q) => [q[0], q[1], q[2], 1]);
const XtX = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
for (let i = 0; i < N; i++) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) XtX[r][c] += X[i][r] * X[i][c];
}
const AFF = [0, 1, 2].map((axis) => {
    const b = WALL.map((p) => p[axis]);
    const rhs = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) for (let r = 0; r < 4; r++) rhs[r] += X[i][r] * b[i];
    return solve4(XtX, rhs);
});
const affApply = (q) => [0, 1, 2].map((axis) => AFF[axis][0] * q[0] + AFF[axis][1] * q[1] + AFF[axis][2] * q[2] + AFF[axis][3]);
const affRes = WALL.map((p, i) => dist(p, affApply(GS[i])));
const affRms = Math.sqrt(affRes.reduce((a, x) => a + x * x, 0) / N);
console.log('  各轴行向量（A_x | b, A_y | b, A_z | b）：');
AFF.forEach((a, i) => console.log(`    ${['x', 'y', 'z'][i]}: [${a.map(fmt).join(', ')}]`));
console.log('  各轴缩放幅度（行向量长度）：', [0, 1, 2].map((a) => fmt(Math.hypot(AFF[a][0], AFF[a][1], AFF[a][2]))).join(' / '));
console.log(`  仿射残差：最大 ${fmt(Math.max(...affRes))}m，RMS ${fmt(affRms)}m`);
console.log(`  → 相似变换 RMS 8.07m vs 仿射 RMS ${fmt(affRms)}m：`);
console.log(`    ${affRms < 1 ? '仿射大幅更准 → 确实存在各轴缩放（变形）' : affRms < 3 ? '仿射明显更准 → 存在由各轴缩放导致的变形' : '仿射改善有限 → 主要问题是对应点选点误差，而非单纯缩放'}`);

console.log('\n========== 空间分布 ==========');
const zs = [...new Set(WALL.map((p) => p[2].toFixed(1)))].join('/');
const xs = [Math.min(...WALL.map((p) => p[0])).toFixed(1), Math.max(...WALL.map((p) => p[0])).toFixed(1)];
const ys = [Math.min(...WALL.map((p) => p[1])).toFixed(1), Math.max(...WALL.map((p) => p[1])).toFixed(1)];
console.log(`  墙点范围 x=[${xs.join(',')}] y=[${ys.join(',')}] z分档={${zs}}`);
console.log(`  8 组比 6 组：x 范围扩大（23→48.8 vs 23→34.9），水平分布更宽；z 仍只有 {0.3/0.6/5.1/7.6} 两档（新增两点 z≈0.6 属低层）`);
console.log(`  → 平移/水平方向明显更稳；俯仰/翻滚方向仍偏弱，建议后续补中高层的点（如 z≈4~7 区间的墙面点）`);