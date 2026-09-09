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

    // 自适应关闭阈值：按该点位到最近邻标注的水平距离 ×0.6（clamp 2~8m）。
    // 修复：原先写死 10m 大于相邻点位间距（约 5~9m），走到旁边点位时仍在范围内，浮窗永不自动关闭。
    const rangeFor = (idx) => {
        const a = annotations[idx];
        if (!a || !a.position) return RANGE;
        let best = 1e9;
        annotations.forEach((b, j) => {
            if (j === idx || !b.position) return;
            const d = Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]);
            if (d < best) best = d;
        });
        const v = best * 0.6;
        return Number.isFinite(v) ? Math.min(8, Math.max(2, v)) : RANGE;
    };

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
        // 强制放大 + 宽屏内（距左右 5px）：容器随图片自适应，溢出可见
        maxWidth: 'calc(100vw - 10px)', maxHeight: '94vh', width: 'fit-content',
        background: 'rgba(18, 22, 30, 0.6)',
        backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        borderRadius: '28px', overflow: 'visible',
        boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.10)',
        fontFamily: '"PingFang SC","Microsoft YaHei",system-ui,sans-serif',
        color: '#f2f5f8', animation: 'poster-pop .28s cubic-bezier(.2,.9,.3,1.2)'
    });
    // 浮云框弹出动画
    const styleSheet = document.createElement('style');
    styleSheet.textContent = `
        @keyframes poster-pop { from { opacity: 0; transform: translate(-50%,-50%) scale(.92); } to { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
        #annotations-poster img.poster-img { width: calc(100vw - 10px) !important; max-width: calc(100vw - 10px) !important; height: auto !important; max-height: 92vh !important; object-fit: contain; display: block; background: #000; }
        /* 放大镜按钮：图片正下方，居中 */
        #annotations-poster .poster-zoom { display: block; margin: 10px auto 8px; width: 42px; height: 42px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.14); color: #fff; font-size: 20px; line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        #annotations-poster .poster-zoom.active { background: rgba(255,214,90,.35); box-shadow: 0 0 10px rgba(255,214,90,.5); }
        /* 永久隐藏官方注解的小黑气泡（title+text 文字说明已移除，官方每帧会强制显示，故用 !important 压制） */
        #ui .pc-annotation { visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }
    `;
    document.head.appendChild(styleSheet);

    poster.innerHTML = `
        <button class="poster-close" style="position:absolute;right:14px;top:12px;z-index:3;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.45);color:#fff;font-size:18px;line-height:1;cursor:pointer;">×</button>
        <img class="poster-img" src="" alt="" style="pointer-events:none;">
        <button class="poster-zoom" type="button" title="放大镜：图片放大 2 倍">🔍</button>
    `;
    document.body.appendChild(poster);
    const closeBtn = poster.querySelector('.poster-close');
    const zoomBtn = poster.querySelector('.poster-zoom');
    const posterImg = poster.querySelector('.poster-img');
    // 放大/拖拽状态
    let zoomed = false;          // 是否放大状态
    let zoomTX = 0;              // 拖拽水平位移（translateX，不占布局=位置写死）
    let lastOperate = 0;         // 最后一次交互时间（放大状态 2s 无操作自动关闭）
    let drag = null;             // 拖动会话 { startX, baseTX }

    const applyImgTransform = () => {
        posterImg.style.transform = zoomed ? `translateX(${zoomTX}px) scale(2)` : '';
    };
    const setZoom = (on) => {
        zoomed = !!on;
        zoomTX = 0;
        drag = null;
        if (zoomed) {
            lastOperate = performance.now();
            posterImg.style.pointerEvents = 'auto';
            posterImg.style.touchAction = 'none';
        } else {
            posterImg.style.pointerEvents = '';
            posterImg.style.touchAction = '';
        }
        zoomBtn.classList.toggle('active', zoomed);
        applyImgTransform();
    };
    const resetZoom = () => setZoom(false);

    // 手机端放大后左右拖拽平移（transform 平移，位置写死不回流）
    posterImg.addEventListener('touchstart', (e) => {
        if (!zoomed) return;
        lastOperate = performance.now();
        const t = e.touches[0];
        drag = { startX: t.clientX, baseTX: zoomTX };
        e.preventDefault();
    }, { passive: false });
    posterImg.addEventListener('touchmove', (e) => {
        if (!zoomed || !drag) return;
        lastOperate = performance.now();
        const t = e.touches[0];
        const dx = t.clientX - drag.startX;
        const half = posterImg.getBoundingClientRect().width / 4; // 放大部分可平移范围
        zoomTX = Math.max(-half, Math.min(half, drag.baseTX + dx));
        applyImgTransform();
        e.preventDefault();
    }, { passive: false });
    posterImg.addEventListener('touchend', () => { drag = null; }, { passive: true });
    posterImg.addEventListener('touchcancel', () => { drag = null; }, { passive: true });

    // ---------- 打开 / 关闭 ----------
    let current = null; // { index, ann } 当前打开的注解

    const open = (index) => {
        const ann = annotations[index];
        if (!ann) return;
        // 记录打开瞬间的相机-点位水平距离：原地停留不关闭，走得更远才开始计 2s 关闭
        let openDist = 0;
        const cam = window.__ssplatCameraEntity;
        if (cam && ann.position) {
            const p = cam.getPosition();
            openDist = Math.hypot(p.x - ann.position[0], p.z - ann.position[2]);
        }
        current = { index, ann, openDist };
        resetZoom();
        posterImg.src = imageUrl(ann.image) || '';
        poster.style.display = 'block';
        startWatcher();
    };
    const close = () => {
        if (!current) return;
        resetZoom();
        poster.style.display = 'none';
        current = null;
        stopWatcher();
        // 关闭浮窗：标注1/2 恢复原图并恢复呼吸（与 index.js __ssplatMarker 联动）
        if (window.__ssplatMarker && typeof window.__ssplatMarker.deactivate === 'function') {
            try { window.__ssplatMarker.deactivate(); } catch (e) { /* 忽略 */ }
        }
    };

    // 放大镜：图片正下方按钮，点击放大 2 倍（可超屏），再点恢复
    zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setZoom(!zoomed);
    });

    // ---------- 相机超距监视：连续超阈值 2s 自动关闭 ----------
    let rafId = null;
    let outSince = null;

    const tickWatch = () => {
        const cam = window.__ssplatCameraEntity;
        if (!cam || !current) { rafId = requestAnimationFrame(tickWatch); return; }
        // 放大状态：2s 无任何操作（最后一次触摸/放大激活）→ 自动关闭
        if (zoomed && (performance.now() - lastOperate) >= CLOSE_DELAY_MS) {
            close();
            return;
        }
        const p = cam.getPosition();
        const a = current.ann.position;
        // 水平距离判断（忽略 y 高差，避免高台点位误判/漏判）
        const dist = Math.hypot(p.x - a[0], p.z - a[2]);
        // 关闭阈值：点位最近邻自适应 与 打开瞬间距离+2m 取大者 —— 原地看图不关，转移相机才开始计 2s
        const t = Math.max(rangeFor(current.index), (current.openDist || 0) + 2);
        if (dist > t) {
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
            // [本补丁-可选性] 箭头标注（selectable=false 或 title 115_点~125_点）绑定空壳：
            //          鼠标点击不弹海报浮窗（官方事件已被拦截，这里独立绑定需同步拦截）。
            const ann = annotations[index];
            if (ann && (ann.selectable === false || /^1(?:1[5-9]|2[0-5])_点$/.test(ann.title || ''))) {
                el.addEventListener('click', (e) => { e.stopPropagation(); });
                return;
            }
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
        // [本补丁-可选性] 箭头标注不弹浮窗（含引擎拾取触发的 activate 兜底路径）
        if (ann.selectable === false || (ann.title && /^1(?:1[5-9]|2[0-5])_点$/.test(ann.title))) return;
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