/**
 * camlog.js —— 相机位姿日志模块（原 custom.js [A]）
 * ------------------------------------------------------------
 * 默认每 1s 向 console 输出当前相机 pos / target / fwd；
 * 键盘按 L 随时输出一条。
 *   ?camlog=0  关闭
 *   ?camlog=N  间隔 N 秒
 * 依赖补丁暴露的 window.__ssplatCameraEntity。
 */
(() => {
    const p = new URLSearchParams(location.search);
    const raw = p.get('camlog');
    const iv = raw === null ? 1 : parseFloat(raw); // 默认每 1s；?camlog=0 关闭
    if (iv === 0) return;
    const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'nan');

    const read = () => {
        const cam = window.__ssplatCameraEntity;
        return cam && typeof cam.getPosition === 'function' ? cam : null;
    };
    const fwdOf = (cam) => {
        const q = (typeof cam.getWorldRotation === 'function') ? cam.getWorldRotation()
            : (typeof cam.getRotation === 'function' ? cam.getRotation() : null);
        if (!q || typeof q.x !== 'number') return { x: 0, y: 0, z: -1 };
        const x = q.x, y = q.y, z = q.z, w = q.w;
        return { x: -(2 * (x * z + y * w)), y: 2 * (x * w - y * z), z: 2 * (x * x + y * y) - 1 };
    };
    const logOnce = () => {
        const cam = read();
        if (!cam) return false;
        try {
            const pos = cam.getPosition();
            const f = fwdOf(cam);
            console.log('[cam] pos=(' + fmt(pos.x) + ', ' + fmt(pos.y) + ', ' + fmt(pos.z) + ')' +
                ' target=(' + fmt(pos.x + f.x * 10) + ', ' + fmt(pos.y + f.y * 10) + ', ' + fmt(pos.z + f.z * 10) + ')' +
                ' fwd=(' + f.x.toFixed(3) + ', ' + f.y.toFixed(3) + ', ' + f.z.toFixed(3) + ')');
            return true;
        } catch (err) { console.warn('[cam] log error:', err); return true; }
    };
    const ready = setInterval(() => {
        if (logOnce()) {
            clearInterval(ready);
            if (iv > 0) setInterval(logOnce, iv * 1000);
        }
    }, 500);
    window.addEventListener('keydown', (e) => { if (e.key === 'l' || e.key === 'L') logOnce(); });
})();