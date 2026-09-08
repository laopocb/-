/**
 * pano-layer.js —— 全景背景（官方 Skybox 方案）
 * ------------------------------------------------------------
 * 用引擎原生 Skybox（cubemap）承接等距柱状全景图 img/pano.jpg，
 * 替换上一版“实体球皮”方案：
 *   - 无实体网格 → 不会有黑球/深度/遮挡/破面问题；
 *   - 天空盒由引擎按相机方向采样，移动镜头天然正确；
 *   - 方位校准烘焙进面片纹理（绕 Y 旋转），无需引擎四元数。
 *
 *   ?pano=0    关闭全景
 *   ?panoRot=N 方位覆盖（度，默认 -20.7：全景图中心/正门对准初始视线）
 *   ?panoCube=N 每面边长（默认 1024，越大越清晰、越耗内存）
 */
(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('pano') === '0') return;
    const ROT_OFFSET = (() => {
        const r = parseFloat(params.get('panoRot'));
        return Number.isFinite(r) ? r : -20.7;
    })(); // 度
    const FACE = (() => {
        const n = parseInt(params.get('panoCube'), 10);
        return Number.isFinite(n) && n >= 256 && n <= 2048 ? n : 1024;
    })();

    const tick = () => {
        const app = window.__ssplatApp;
        const cam = window.__ssplatCameraEntity;
        if (!app || !cam) { setTimeout(tick, 300); return; }
        if (!app.scene.skybox) { init(app); }
        setTimeout(tick, 1000);
    };

    // ----------------------------------------------------------
    // 等距柱状 → 立方体贴图（6 面，含绕 Y 旋转烘焙）
    // 方向约定：dir = (dx,dy,dz)；θ = atan2(dx,dz)，φ = asin(dy)
    // 采样源：u = θ/(2π)+0.5，v = 0.5 - φ/π（与引擎 sampleEquirect 一致，无需镜像）
    // ----------------------------------------------------------
    const equirectToCubemap = (srcImg) => {
        const srcW = srcImg.naturalWidth, srcH = srcImg.naturalHeight;
        const sCv = document.createElement('canvas');
        sCv.width = srcW; sCv.height = srcH;
        const sG = sCv.getContext('2d', { willReadFrequently: true });
        sG.drawImage(srcImg, 0, 0);
        const sData = sG.getImageData(0, 0, srcW, srcH).data;

        const faces = [
            // PC cubemap 顺序：+X, -X, +Y, -Y, +Z, -Z
            { x: 1, y: -1, z: -1, u: 'z', v: 'y' }, // px
            { x: -1, y: -1, z: 1, u: 'z', v: 'y' }, // nx
            { x: 1, y: 1, z: -1, u: 'x', v: 'z', sw: -1 }, // py（顶面取向微调）
            { x: 1, y: -1, z: 1, u: 'x', v: 'z', sw: -1 }, // ny
            { x: 1, y: -1, z: 1, u: 'x', v: 'y' }, // pz
            { x: -1, y: -1, z: -1, u: 'x', v: 'y' } // nz
        ];
        // 物理朝向（每面法线）。dir 由 (u,v) 与基向量合成：
        // face 基：u 轴向右、v 轴向上，法线 n。dir = u*uAxis + v*vAxis + n
        const AXIS = {
            px: { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
            nx: { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
            py: { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1] },
            ny: { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, -1] },
            pz: { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
            nz: { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] }
        };
        const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
        const rotRad = (ROT_OFFSET * Math.PI) / 180;
        const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);

        const half = FACE / 2;
        const out = [];
        for (const faceName of order) {
            const { n, a, b } = AXIS[faceName];
            const cv = document.createElement('canvas');
            cv.width = FACE; cv.height = FACE;
            const g = cv.getContext('2d');
            const id = g.createImageData(FACE, FACE);
            const d = id.data;
            for (let py = 0; py < FACE; py++) {
                const vv = (py + 0.5) / half - 1; // -1..1（向上）
                for (let px = 0; px < FACE; px++) {
                    const uu = (px + 0.5) / half - 1; // -1..1（向右）
                    // dir = uu*a + vv*b + n，归一再绕 Y 旋转
                    let dx = uu * a[0] + vv * b[0] + n[0];
                    let dy = uu * a[1] + vv * b[1] + n[1];
                    let dz = uu * a[2] + vv * b[2] + n[2];
                    const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
                    dx *= inv; dy *= inv; dz *= inv;
                    // 绕 Y 旋转（顺时针为正，align 全景中心到初始视线）
                    const rx = dx * cosR + dz * sinR;
                    const rz = -dx * sinR + dz * cosR;
                    dx = rx; dz = rz;
                    // → 等距 uv
                    const u = (Math.atan2(dx, dz) / (2 * Math.PI) + 0.5) % 1;
                    const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, dy))) / Math.PI;
                    const sx = Math.min(srcW - 1, Math.max(0, u * srcW));
                    const sy = Math.min(srcH - 1, Math.max(0, v * srcH));
                    // 双线性
                    const x0 = Math.floor(sx), y0 = Math.floor(sy);
                    const x1 = Math.min(srcW - 1, x0 + 1), y1 = Math.min(srcH - 1, y0 + 1);
                    const fx = sx - x0, fy = sy - y0, nfx = 1 - fx, nfy = 1 - fy;
                    const o00 = (y0 * srcW + x0) * 4, o10 = (y0 * srcW + x1) * 4;
                    const o01 = (y1 * srcW + x0) * 4, o11 = (y1 * srcW + x1) * 4;
                    const i = (py * FACE + px) * 4;
                    for (let c = 0; c < 3; c++) {
                        const v00 = sData[o00 + c], v10 = sData[o10 + c];
                        const v01 = sData[o01 + c], v11 = sData[o11 + c];
                        const top = v00 * nfx + v10 * fx;
                        const bot = v01 * nfx + v11 * fx;
                        d[i + c] = top * nfy + bot * fy;
                    }
                    d[i + 3] = 255;
                }
            }
            g.putImageData(id, 0, 0);
            out.push(new Uint8Array(id.data.buffer.slice(0)));
        }
        return out; // 6 × Uint8Array(FACE*FACE*4)，顺序 px,nx,py,ny,pz,nz
    };

    const init = (app) => {
        const img = new Image();
        img.onload = () => {
            try {
                const faces = equirectToCubemap(img);
                const dv = app.graphicsDevice;
                const tex = new window.__ssplatPano.Texture(dv, {
                    width: FACE, height: FACE,
                    format: window.__ssplatPano.PIXELFORMAT_RGBA8,
                    cubemap: true,
                    mipmaps: false,
                    minFilter: window.__ssplatPano.FILTER_LINEAR,
                    magFilter: window.__ssplatPano.FILTER_LINEAR,
                    levels: [faces]
                });
                app.scene.skybox = tex;
                app.scene.skyboxIntensity = 1;
                app.scene.skyboxMip = 0;
                app.renderNextFrame = true;
                console.log('[pano] skybox 全景已就位 FACE=' + FACE + ' rotY=' + ROT_OFFSET.toFixed(1) + '°');
            } catch (err) {
                console.warn('[pano] 全景纹理创建失败：', err);
            }
        };
        img.onerror = () => console.warn('[pano] 全景图加载失败：./img/pano.jpg');
        img.src = './img/pano.jpg';
    };

    setTimeout(tick, 500);
})();