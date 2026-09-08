/**
 * 页面内 OSD 状态面板（独立模块脚本）
 * ============================================================================
 * 在页面右上角常驻一块半透明小面板，实时显示：
 *   1. 相机位姿：pos / target（前向10m点）/ fov —— 每 0.5s 刷新（复用 camlog 同款读数）
 *   2. 标注层状态：GeoJSON 加载数量 / 错误（监听 points:loaded|points:error）
 *   3. 点击面板头部可折叠；?osd=0 关闭本面板。
 *
 * 目的：让使用者在页面内直接查看相机与标注日志，无需 F12、无需跳转。
 */

const params = new URLSearchParams(location.search);
if (params.get('osd') === '1') {
    const panel = document.createElement('div');
    panel.id = 'osd-panel';
    Object.assign(panel.style, {
        position: 'fixed', right: '12px', top: '12px', zIndex: '2000',
        minWidth: '280px', maxWidth: '360px',
        background: 'rgba(12, 15, 20, 0.82)', color: '#d7dde5',
        borderRadius: '10px', font: '12px/1.55 Consolas, "Courier New", monospace',
        boxShadow: '0 8px 28px rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden', userSelect: 'none'
    });
    panel.innerHTML = `
        <div class="osd-head" style="display:flex;justify-content:space-between;align-items:center;
            padding:6px 10px;background:rgba(255,255,255,0.05);cursor:pointer;">
            <span style="font-weight:600;letter-spacing:1px;">O S D</span>
            <span style="color:#8a93a0;">[收起]</span>
        </div>
        <div class="osd-body" style="padding:8px 10px 10px;">
            <div class="osd-cam"></div>
            <div class="osd-pts" style="margin-top:6px;padding-top:6px;border-top:1px dashed rgba(255,255,255,0.12);"></div>
        </div>
    `;
    document.body.appendChild(panel);

    const elCam = panel.querySelector('.osd-cam');
    const elPts = panel.querySelector('.osd-pts');
    let collapsed = false;

    panel.querySelector('.osd-head').addEventListener('click', () => {
        collapsed = !collapsed;
        panel.querySelector('.osd-body').style.display = collapsed ? 'none' : 'block';
        panel.querySelector('.osd-head span:last-child').textContent = collapsed ? '[展开]' : '[收起]';
    });

    const f = (n) => (Number.isFinite(n) ? n.toFixed(2) : '--');
    const camLine = (tag, x, y, z) =>
        `<span style="color:#5ec8ff">${tag}</span> ${f(x)}, ${f(y)}, ${f(z)}`;

    /** 相机读数（与 camlog 一致：quat 共轭旋转 v=(0,0,-1) 得前向） */
    const readCamera = () => {
        const cam = window.__ssplatCameraEntity;
        if (!cam || typeof cam.getPosition !== 'function') return null;
        const p = cam.getPosition();
        let fx = 0, fy = 0, fz = -1;
        const q = (typeof cam.getWorldRotation === 'function') ? cam.getWorldRotation()
            : (typeof cam.getRotation === 'function' ? cam.getRotation() : null);
        if (q && typeof q.x === 'number') {
            const x = q.x, y = q.y, z = q.z, w = q.w;
            fx = -(2 * (x * z + y * w));
            fy = 2 * (x * w - y * z);
            fz = 2 * (x * x + y * y) - 1;
        }
        let fov = 75;
        if (cam.camera && typeof cam.camera.fov === 'number') fov = cam.camera.fov;
        return { p, fx, fy, fz, fov };
    };

    const renderCam = () => {
        const r = readCamera();
        if (!r) {
            elCam.innerHTML = '<span style="color:#8a93a0">相机未就绪…</span>';
            return;
        }
        elCam.innerHTML =
            camLine('pos   ', r.p.x, r.p.y, r.p.z) +
            '<br>' +
            camLine('target', r.p.x + r.fx * 10, r.p.y + r.fy * 10, r.p.z + r.fz * 10) +
            `<span style="color:#8a93a0">   fov=${Math.round(r.fov)}</span>`;
    };

    const renderPts = (force) => {
        const s = window.__ssplatPoints;
        const visible = window.__ssplatPointsVisible;
        const total = s && (s.count || 0);
        const visText = (typeof visible === 'number' && total)
            ? `（视锥内 <b style="color:${visible ? '#5fe08a' : '#ff7b72'}">${visible}</b>/${total}）`
            : '';
        const text = (s && s.type === 'loaded')
            ? `<span style="color:#5fe08a">●</span> 标注：<b>${s.count}</b> 个 ${visText}`
            : (s && s.type === 'error')
                ? `<span style="color:#ff7b72">●</span> 标注异常：${s.message || '未知'}`
                : '<span style="color:#8a93a0">○</span> 标注加载中…';
        elPts.innerHTML = text;
    };

    renderCam();
    renderPts();
    setInterval(() => { renderCam(); renderPts(); }, 500);
    window.addEventListener('points:loaded', renderPts);
    window.addEventListener('points:error', renderPts);
    window.addEventListener('points:visibility', renderPts);
    console.log('[osd] 页面状态面板已显示（右上角；?osd=0 关闭）');
}