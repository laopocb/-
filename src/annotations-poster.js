/**
 * annotations-poster.js —— 官方注解点击弹出高清大图浮窗（浮云框）
 * ----------------------------------------------------------------------------
 * 逻辑：
 *   1. fetch ./settings.json 的 annotations（含自定义 image 字段），
 *      构建 序号 → { title, text, position, image } 映射；
 *   2. 官方每个注解都会在 #annotations 容器里创建 .pc-annotation-hotspot（点击它=官方 showTooltip）。
 *      本模块监听这些 hotspot 的 click：按容器内子节点顺序反查注解序号，
 *      打开"浮云框"显示高清大图（image 路径 = ./data/<image>）；
 *   3. 浮云框：仅展示高清大图（无文字说明），尺寸为设计基准的 50%；
 *      官方注解的小黑气泡（title+text）由 CSS !important 永久隐藏（官方每帧会强制重新显示，
 *      故不能用临时 JS 隐藏）；
 *   4. 相机距离监视：浮窗打开后每 250ms 检查相机与注解点距离，
 *      连续超过阈值 RANGE 满 2s → 自动关闭；回到范围内则重新计时。
 *
 * URL 参数：
 *   ?posterr=8   距离阈值（米，默认 10）
 *   ?poster=0    关闭本模块
 */
(async () => {
    const params = new URLSearchParams(location.search);
    const ENABLED = params.get('poster') !== '0';
    const RANGE = (() => {
        const raw = params.get('posterr');
        const v = Number(raw);
        return Number.isFinite(v) && v > 0 ? v : 10;
    })();
    const CLOSE_DELAY_MS = 2000; // 连续超距 N ms 后自动关闭
    if (!ENABLED) return;

    // ---------- 读取 settings.json 的注解（含 image 字段） ----------
    let annotations = [];
    try {
        const res = await fetch('./settings.json');
        const settings = await res.json();
        annotations = Array.isArray(settings.annotations) ? settings.annotations : [];
    } catch (err) {
        console.warn('[poster] settings.json 加载失败：', err);
        return;
    }
    if (annotations.length === 0) return;
    const imageUrl = (image) => image ? './data/' + encodeURI(image.replace(/^\/+/, '')) : null;

    // ---------- 浮云框 DOM（仅图片：无标题/文字说明） ----------
    const poster = document.createElement('div');
    poster.id = 'annotations-poster';
    Object.assign(poster.style, {
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        display: 'none', zIndex: '2000',
        // 尺寸为过往版本的 50%
        maxWidth: 'min(430px, 47vw)', maxHeight: '45vh',
        background: 'rgba(18, 22, 30, 0.6)',
        backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        borderRadius: '28px', overflow: 'hidden',
        boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.10)',
        fontFamily: '"PingFang SC","Microsoft YaHei",system-ui,sans-serif',
        color: '#f2f5f8', animation: 'poster-pop .28s cubic-bezier(.2,.9,.3,1.2)'
    });
    // 浮云框弹出动画
    const styleSheet = document.createElement('style');
    styleSheet.textContent = `
        @keyframes poster-pop { from { opacity: 0; transform: translate(-50%,-50%) scale(.92); } to { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
        #annotations-poster img.poster-img { width: 100%; max-height: 31vh; object-fit: contain; display: block; background: #000; }
        /* 永久隐藏官方注解的小黑气泡（title+text 文字说明已移除，官方每帧会强制显示，故用 !important 压制） */
        #ui .pc-annotation { visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }
    `;
    document.head.appendChild(styleSheet);

    poster.innerHTML = `
        <button class="poster-close" style="position:absolute;right:14px;top:12px;z-index:3;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.45);color:#fff;font-size:18px;line-height:1;cursor:pointer;">×</button>
        <img class="poster-img" src="" alt="" style="pointer-events:none;">
    `;
    document.body.appendChild(poster);
    const closeBtn = poster.querySelector('.poster-close');

    // ---------- 打开 / 关闭 ----------
    let current = null; // { index, ann } 当前打开的注解

    const open = (index) => {
        const ann = annotations[index];
        if (!ann) return;
        current = { index, ann };
        poster.querySelector('.poster-img').src = imageUrl(ann.image) || '';
        poster.style.display = 'block';
        startWatcher();
    };
    const close = () => {
        if (!current) return;
        poster.style.display = 'none';
        current = null;
        stopWatcher();
        // 关闭浮窗：标注1/2 恢复原图并恢复呼吸（与 index.js __ssplatMarker 联动）
        if (window.__ssplatMarker && typeof window.__ssplatMarker.deactivate === 'function') {
            try { window.__ssplatMarker.deactivate(); } catch (e) { /* 忽略 */ }
        }
    };

    // ---------- 相机超距监视：连续超阈值 2s 自动关闭 ----------
    let rafId = null;
    let outSince = null;

    const tickWatch = () => {
        const cam = window.__ssplatCameraEntity;
        if (!cam || !current) { rafId = requestAnimationFrame(tickWatch); return; }
        const p = cam.getPosition();
        const a = current.ann.position;
        const dist = Math.hypot(p.x - a[0], p.y - a[1], p.z - a[2]);
        if (dist > RANGE) {
            if (outSince === null) outSince = performance.now();
            if (performance.now() - outSince >= CLOSE_DELAY_MS) {
                close();
                return;
            }
        } else {
            outSince = null; // 回到范围内，重新计时
        }
        rafId = requestAnimationFrame(tickWatch);
    };
    const startWatcher = () => { if (!rafId) { outSince = null; rafId = requestAnimationFrame(tickWatch); } };
    const stopWatcher = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } outSince = null; };

    // ---------- 触发方式1：监听官方 hotspot DOM 点击（按容器内子节点顺序反查序号） ----------
    // 本轮不做遮挡拦截：图标常显常点（遮挡深度判定此前实验不再启用，避免图标消失/点不着的回归）。
    const isPointOccluded = () => false;
    const seen = new WeakSet();
    const bindHotspots = () => {
        const parent = document.querySelector('#annotations');
        if (!parent) return;
        const hotspots = parent.querySelectorAll('.pc-annotation-hotspot');
        hotspots.forEach((el, index) => {
            if (seen.has(el)) return;
            seen.add(el);
            el.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止冒泡触发官方的 document click（隐藏逻辑）
                if (isPointOccluded(annotations[index]?.position)) return; // 被遮挡：不弹浮窗
                open(index);
            });
        });
    };

    // ---------- 触发方式2（兜底）：监听官方 annotation.activate 事件（引擎拾取 3D 圆点触发） ----------
    const openByAnnotation = (ann) => {
        if (!ann) return;
        if (isPointOccluded(ann.position)) return; // 被遮挡：不弹浮窗（与 activate 源拦截一致）
        let idx = -1;
        if (ann && ann.position) {
            idx = annotations.findIndex(
                (a) => a.position && Math.abs(a.position[0] - ann.position[0]) < 0.01 &&
                    Math.abs(a.position[1] - ann.position[1]) < 0.01 &&
                    Math.abs(a.position[2] - ann.position[2]) < 0.01
            );
        }
        if (idx < 0) {
            // 兜底：按注释实体位置匹配 settings 注解坐标
            const p = ann.entity && typeof ann.entity.getPosition === 'function' ? ann.entity.getPosition() : null;
            if (p) {
                idx = annotations.findIndex(
                    (a) => a.position &&
                        Math.abs(a.position[0] - p.x) < 0.05 &&
                        Math.abs(a.position[1] - p.y) < 0.05 &&
                        Math.abs(a.position[2] - p.z) < 0.05
                );
            }
        }
        if (idx >= 0) open(idx);
    };
    const waitAppForActivate = async () => {
        for (let i = 0; i < 200; i++) {
            const app = window.__ssplatApp;
            if (app && app.events && typeof app.events.on === 'function') {
                try { app.events.on('annotation.activate', openByAnnotation); return; } catch (e) { /* 忽略 */ }
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    };
    waitAppForActivate().catch(() => {});

    // 官方注解 DOM 生成时机不定：DOM 变化时增量绑定
    const mo = new MutationObserver(bindHotspots);
    const waitAnnotations = async () => {
        for (let i = 0; i < 400; i++) {
            const parent = document.querySelector('#annotations');
            if (parent) {
                mo.observe(parent, { childList: true, subtree: true });
                bindHotspots();
                return;
            }
            await new Promise((r) => setTimeout(r, 150));
        }
    };
    waitAnnotations().catch(() => {});

    // ---------- 关闭交互：按钮 / 点击遮罩 / Esc ----------
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    poster.addEventListener('click', (e) => { if (e.target === poster) close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();