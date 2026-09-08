/**
 * 三维点标注层（独立模块脚本）
 * ============================================================================
 * 职责：
 *   1. 加载 data/dian.geojson（Point FeatureCollection），解析每个 feature：
 *        - properties.num / image / title / desc
 *        - geometry.coordinates = [px, py, pz]（数据坐标）
 *   2. 把数据坐标变换为 viewer 世界坐标：
 *        世界 = (px, pz, -py)（与 overlay.js 挤出体同变换）
 *        → 浮到地面 0.4m 之上，避免沉入地面
 *   3. 每帧从 __ssplatCameraEntity 读取位姿与 FOV，把 3D 点投影到屏幕 → 设置
 *      对应 DOM 标签的 CSS transform。点不在视锥内或相机未就绪时隐藏。
 *   4. 交互：
 *        - 鼠标悬停：标签放大 + 显示标题文字
 *        - 单击标签：在屏幕中央弹出信息卡（图片 / 标题 / 说明 / 跳转 / 关闭）
 *        - 单击卡片外 / 按 Esc / 点关闭按钮：关闭卡片
 *
 * DOM 结构：
 *   <div id="points-layer">           (全屏容器，pointer-events:none)
 *     <div class="pt-label" ...>     (单个标签，pointer-events:auto)
 *     <div class="pt-card hidden">   (信息卡，pointer-events:auto)
 *
 * URL 参数：
 *   ?dian=./data/xxx.geojson   替换标注文件（默认 ./data/dian.geojson）
 *   ?dian=0                    关闭此层
 *   仅当参数是真实路径时采用；占位/空值一律回退默认文件；加载失败自动重试默认。
 *
 * 状态通知：加载成功/失败通过 window.__ssplatPoints 暴露 + 派发
 *   window 'points:loaded' / 'points:error' 事件，供页面内 OSD 读取。
 */

const params = new URLSearchParams(location.search);
const DEFAULT_DIAN_URL = './data/dian.geojson';
const rawDian = params.get('dian');
const GEOJSON_URL = (rawDian !== null && rawDian !== '0' && !/xxx|yyy/.test(rawDian)) ? rawDian : DEFAULT_DIAN_URL;
const LAYER_DISABLED = rawDian === '0';
const notify = (type, payload) => {
    window.__ssplatPoints = { type, ...payload };
    try { window.dispatchEvent(new CustomEvent(type === 'loaded' ? 'points:loaded' : 'points:error', { detail: payload })); } catch (e) { /* noop */ }
};

if (LAYER_DISABLED) {
    console.log('[points] 已关闭（?dian=0）');
    notify('error', { count: 0, message: '标注层已关闭 (?dian=0)' });
} else {
    const url = GEOJSON_URL;

    // ---------- DOM 容器 ----------
    const layer = document.createElement('div');
    layer.id = 'points-layer';
    Object.assign(layer.style, {
        position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: '900', fontFamily: '"PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    });
    document.body.appendChild(layer);

    // 信息卡（单例）
    const card = document.createElement('div');
    card.className = 'pt-card hidden';
    Object.assign(card.style, {
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        maxWidth: 'min(560px, 92vw)', background: 'rgba(20, 22, 28, 0.94)',
        color: '#eaeaea', borderRadius: '14px', padding: '0',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
        pointerEvents: 'auto', zIndex: '1100', overflow: 'hidden',
        backdropFilter: 'blur(8px)'
    });
    card.innerHTML = `
        <div class="pt-card-img" style="width:100%;aspect-ratio:16/9;background:#000 center/cover no-repeat;"></div>
        <div style="padding:18px 20px 20px;">
            <div class="pt-card-title" style="font-size:18px;font-weight:600;margin-bottom:8px;"></div>
            <div class="pt-card-desc" style="font-size:13px;line-height:1.6;color:#bbb;margin-bottom:16px;"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="pt-card-fly" style="background:#0a84ff;color:#fff;border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;">飞到此处</button>
                <button class="pt-card-close" style="background:transparent;color:#aaa;border:1px solid #444;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(card);
    card.querySelector('.pt-card-close').addEventListener('click', () => card.classList.add('hidden'));
    card.addEventListener('click', (e) => e.stopPropagation());

    // 点卡片外/按 Esc 关闭
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') card.classList.add('hidden'); });
    layer.addEventListener('click', () => card.classList.add('hidden'));

    // ---------- 标注数据 ----------
    /** @type {Array<{ num:number, image:string, title:string, desc:string, world:{x:number,y:number,z:number} }>} */
    const points = [];

    /** 把数据坐标 [px,py,pz] → viewer 世界（与挤出体同变换：(px, pz, -py)） */
    const dataToWorld = (px, py, pz) => ({ x: px, y: pz + 0.4, z: -py });

    /** 创建一个标签 DOM */
    const makeLabel = (pt, idx) => {
        const el = document.createElement('div');
        el.className = 'pt-label';
        el.dataset.idx = String(idx);
        Object.assign(el.style, {
            position: 'absolute', left: '0', top: '0',
            transform: 'translate3d(-9999px,-9999px,0)', // 先藏屏外
            pointerEvents: 'auto', cursor: 'pointer', userSelect: 'none',
            willChange: 'transform'
        });
        el.innerHTML = `
            <div class="pt-arrow" style="position:absolute;left:50%;top:50%;width:26px;height:26px;
                transform:translate(-50%,-50%) rotate(45deg);opacity:0;
                pointer-events:none;transition:opacity .12s ease;
                border-top:3px solid #0a84ff;border-right:3px solid #0a84ff;
                filter:drop-shadow(0 0 4px rgba(10,132,255,0.7));"></div>
            <div class="pt-dot" style="width:34px;height:34px;border-radius:50%;background:rgba(10,132,255,0.85);
                border:2px solid #fff;display:flex;align-items:center;justify-content:center;
                color:#fff;font-weight:700;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,0.4);
                transition:transform .15s ease, opacity .15s ease;">${pt.num}</div>
            <div class="pt-cap" style="position:absolute;left:42px;top:50%;transform:translateY(-50%);
                background:rgba(10,14,22,0.85);color:#fff;padding:6px 10px;border-radius:8px;
                font-size:13px;white-space:nowrap;opacity:0;transition:opacity .15s ease;
                border:1px solid rgba(255,255,255,0.08);pointer-events:none;">${pt.title}</div>
        `;
        const dot = el.querySelector('.pt-dot');
        const cap = el.querySelector('.pt-cap');
        const arrow = el.querySelector('.pt-arrow');
        el.addEventListener('mouseenter', () => { dot.style.transform = 'scale(1.18)'; cap.style.opacity = '1'; });
        el.addEventListener('mouseleave', () => { dot.style.transform = 'scale(1)'; cap.style.opacity = '0'; });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            // 填卡
            card.querySelector('.pt-card-img').style.backgroundImage = `url('./data/点位/${pt.image}')`;
            card.querySelector('.pt-card-title').textContent = `${pt.num}. ${pt.title}`;
            card.querySelector('.pt-card-desc').textContent = pt.desc;
            card.classList.remove('hidden');
            // 替换跳转按钮事件
            const flyBtn = card.querySelector('.pt-card-fly');
            flyBtn.onclick = () => {
                // 把位置相机点放到标签 5m 外（沿相机→标签方向）
                const cam = window.__ssplatCameraEntity;
                if (!cam) return;
                const camPos = cam.getPosition();
                const dx = pt.world.x - camPos.x, dy = pt.world.y - camPos.y, dz = pt.world.z - camPos.z;
                const len = Math.hypot(dx, dy, dz) || 1;
                const standOff = 4;
                window.__ssplatCameraManager?.snap?.();
                cam.setPosition?.(pt.world.x - dx/len*standOff, pt.world.y - dy/len*standOff, pt.world.z - dz/len*standOff);
                cam.lookAt?.(pt.world);
                card.classList.add('hidden');
            };
        });
        layer.appendChild(el);
        return el;
    };

    /** 加载 GeoJSON（失败时若当前非默认文件，则回退到默认文件重试一次） */
    const tryLoad = async (candidate) => {
        const res = await fetch(candidate);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    };
    (async () => {
        try {
            let gj;
            try {
                gj = await tryLoad(url);
            } catch (err) {
                if (url !== DEFAULT_DIAN_URL) {
                    console.warn(`[points] ${url} 加载失败，回退默认 ${DEFAULT_DIAN_URL}`);
                    gj = await tryLoad(DEFAULT_DIAN_URL);
                } else {
                    throw err;
                }
            }
            const features = Array.isArray(gj.features) ? gj.features : [];
            for (let i = 0; i < features.length; i++) {
                const f = features[i];
                const g = f.geometry;
                if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
                const [px, py, pz] = g.coordinates;
                const p = f.properties || {};
                const world = dataToWorld(px, py, pz);
                points.push({
                    num: p.num || (i + 1),
                    image: p.image || `${i + 1}.jpg`,
                    title: p.title || `标注 ${i + 1}`,
                    desc: p.desc || '',
                    world
                });
            }
            // 建标签
            points.forEach((pt, i) => layer.appendChild(makeLabel(pt, i)));
            notify('loaded', { count: points.length, source: url });
            console.log(`[points] 标注已加载：${points.length} 个  ←  ${url}`);
        } catch (err) {
            notify('error', { count: 0, message: String(err && err.message || err) });
            console.warn('[points] GeoJSON 加载失败：', err);
        }
    })();

    // ---------- 每帧投影 ----------
    /** 四元数共轭旋转向量（世界→相机空间） */
    const rotateByQuat = (v, qx, qy, qz, qw) => ({
        x: v.x * (1 - 2 * (qy * qy + qz * qz)) + v.y * 2 * (qx * qy - qz * qw) + v.z * 2 * (qx * qz + qy * qw),
        y: v.x * 2 * (qx * qy + qz * qw) + v.y * (1 - 2 * (qx * qx + qz * qz)) + v.z * 2 * (qy * qz - qx * qw),
        z: v.x * 2 * (qx * qz - qy * qw) + v.y * 2 * (qy * qz + qx * qw) + v.z * (1 - 2 * (qx * qx + qy * qy))
    });

    const labels = () => layer.querySelectorAll('.pt-label');

    // 诊断状态（每帧更新，每秒输出一行；失败/异常也输出）
    let __lastDiag = 0, __loggedNoCam = false, __loggedCamErr = false, __diagBoot = false;
    const diag = { lastModes: [], lastDist: [], lastScreen: [] };

    const tick = () => {
        requestAnimationFrame(tick);
        const cam = window.__ssplatCameraEntity;
        if (!cam || points.length === 0) {
            if (!__loggedNoCam && points.length > 0) {
                console.warn('[points] 诊断：相机未就绪 __ssplatCameraEntity=', !!cam);
                __loggedNoCam = true;
            }
            return;
        }
        __loggedNoCam = false;
        let pos, q, fov = 75, horizontalFov = false;
        try {
            pos = cam.getPosition();
            q = (typeof cam.getWorldRotation === 'function') ? cam.getWorldRotation()
              : (typeof cam.getRotation === 'function' ? cam.getRotation() : null);
            if (!q) throw new Error('相机无 getRotation 方法');
            if (cam.camera) {
                if (typeof cam.camera.fov === 'number') fov = cam.camera.fov;
                horizontalFov = !!cam.camera.horizontalFov;
            }
        } catch (err) {
            if (!__loggedCamErr) { console.warn('[points] 诊断：相机读数异常：', err); __loggedCamErr = true; }
            return;
        }
        __loggedCamErr = false;
        const fovRad = fov * Math.PI / 180;
        const aspect = window.innerWidth / window.innerHeight;
        const tanV = Math.tan(fovRad / 2);
        const tanH = horizontalFov ? Math.tan(fovRad / 2) : tanV * aspect;

        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        const els = labels();
        let visible = 0;
        els.forEach((el, i) => {
            const p = points[i];
            if (!p) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; return; }
            const dot = el.querySelector('.pt-dot');
            const arrow = el.querySelector('.pt-arrow');
            const rel = { x: p.world.x - pos.x, y: p.world.y - pos.y, z: p.world.z - pos.z };
            // 共轭四元数：world → camera space
            const local = rotateByQuat(rel, -q.x, -q.y, -q.z, q.w);
            // 诊断：记录局部坐标与 NDC
            let __dbgNdc = null;

            let mode, sx, sy, ndcX, ndcY, depthScale;
            if (local.z >= -0.05) {
                // 在相机后方：屏幕底部居中排列 + 朝下箭头
                mode = 'behind';
                sx = cx;
                sy = window.innerHeight - 64 - i * 36;
                ndcX = (sx - cx) / cx;
                ndcY = -(sy - cy) / cy;
                depthScale = 1;
            } else {
                ndcX = local.x / (-local.z) / tanH;
                ndcY = local.y / (-local.z) / tanV;
                __dbgNdc = { x: ndcX, y: ndcY };
                if (Math.abs(ndcX) <= 1.05 && Math.abs(ndcY) <= 1.05) {
                    // 视锥内
                    mode = 'in';
                    sx = cx + ndcX * cx;
                    sy = cy - ndcY * cy;
                    depthScale = Math.max(0.7, Math.min(1.3, 10 / (-local.z)));
                    visible += 1;
                } else {
                    // 视锥外（前但侧出）→ clamp 到屏幕边缘（保留 36px padding）
                    mode = 'edge';
                    const ax = Math.abs(ndcX), ay = Math.abs(ndcY);
                    const k = 0.92 / Math.max(ax, ay);
                    ndcX *= k; ndcY *= k;
                    sx = cx + ndcX * cx;
                    sy = cy - ndcY * cy;
                    // 距越远缩放越小（不缩放太多）
                    depthScale = Math.max(0.55, Math.min(1, 14 / (-local.z)));
                }
            }
            // 写入诊断
            diag.lastModes[i] = mode;
            diag.lastDist[i] = -local.z;
            diag.lastScreen[i] = { x: sx, y: sy };

            // 应用到 DOM
            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
            el.style.transform = `translate3d(${sx - 17}px, ${sy - 17}px, 0) scale(${depthScale.toFixed(2)})`;
            el.style.zIndex = String(mode === 'in' ? (1500 - Math.floor(-local.z)) : (1490 + (mode === 'behind' ? i : 0)));

            // dot / arrow 显隐
            if (mode === 'in') {
                dot.style.opacity = '1';
                arrow.style.opacity = '0';
            } else if (mode === 'edge') {
                dot.style.opacity = '0.35';
                arrow.style.opacity = '1';
                // arrow 指向真实 NDC 方向：atan2 在屏幕坐标里 ndcY 朝下为正，但 arrow 用旋转 -atan2
                const ang = Math.atan2(-ndcY, ndcX) * 180 / Math.PI; // 屏幕 x=0, y=正为下；旋转 0 朝右
                arrow.style.transform = `translate(-50%,-50%) rotate(${ang}deg)`;
            } else { // behind
                dot.style.opacity = '0.25';
                arrow.style.opacity = '1';
                arrow.style.transform = `translate(-50%,-50%) rotate(225deg)`; // 朝下
            }
        });
        // 通知 OSD 可见数
        window.__ssplatPointsVisible = visible;
        try { window.dispatchEvent(new CustomEvent('points:visibility', { detail: { visible, total: points.length } })); } catch (e) {}

        // 每秒诊断日志
        const now = performance.now();
        if (now - __lastDiag > 1000) {
            __lastDiag = now;
            const summary = diag.lastModes.map((m, i) =>
                `${i + 1}:${m}@${(diag.lastDist[i] || 0).toFixed(1)}m(${Math.round(diag.lastScreen[i]?.x || 0)},${Math.round(diag.lastScreen[i]?.y || 0)})`
            ).join(' | ');
            console.log(`[points] viewport=${window.innerWidth}x${window.innerHeight} fov=${Math.round(fov)}  ${summary}  visible=${visible}/${points.length}`);
        }
    };
    if (!__diagBoot) { __diagBoot = true; console.log('[points] tick 已启动（每 1s 输出一次各点状态）'); }
    requestAnimationFrame(tick);
}