/**
 * camera-constraint.js —— 相机高度与俯仰约束（行走/飞行视角）
 * ----------------------------------------------------------------------------
 * 规则（产品硬性要求，非自由可调）：
 *   1. 高度：相机固定在地面之上 1.5m（眼高）——每帧以空气墙碰撞体(1.collision.glb)向下探测
 *      当前站立处的结构高度，相机 y = 结构面 + 1.5。结构有台阶/夹层时相机随之升高；
 *      其他任何改变高度的手段（自由升降/滚轮/跳跃）一律被本模块按帧纠正，高度写死。
 *   2. 俯仰：只能水平 360° 旋转，上下俯仰限制 ±20°（统一按帧钳制相机欧拉角 X）。
 *
 * 生效范围：fly / walk（带空气墙碰撞的行走视角）；?free=1 调试自由飞行或 orbit/anim
 *          模式不干预（避免破坏点位纠偏与环绕视角）。
 *
 * 依赖：window.__ssplatCameraEntity（相机实体）、window.__ssplatCollision（空气墙碰撞体）、
 *       window.__ssplatMode（相机模式）、window.__ssplatFreeFly。
 */
(() => {
    const EYE_HEIGHT = 1.5; // 眼高（米），强制
    const PITCH_MAX = 20;   // 俯仰限制（度）
    const DROP_RAY = 30;    // 向下探测最大距离（米）——原 8m 在落差大/平台处打空导致高度失效

    const clampPitch = (cam) => {
        const q = cam.getRotation();
        const fy = 2 * (q.x * q.w - q.y * q.z);
        const pitchDeg = (Math.asin(Math.max(-1, Math.min(1, fy))) * 180) / Math.PI;
        if (pitchDeg > PITCH_MAX || pitchDeg < -PITCH_MAX) {
            const excess = (pitchDeg > PITCH_MAX ? pitchDeg - PITCH_MAX : pitchDeg + PITCH_MAX) * Math.PI / 180;
            const s = Math.sin(-excess / 2), c = Math.cos(-excess / 2);
            const wx = q.w * c - q.x * s;
            const xx = q.w * s + q.x * c;
            const yx = q.y * c + q.z * s;
            const zx = q.z * c - q.y * s;
            cam.setRotation(xx, yx, zx, wx);
        }
    };

    // 等引擎暴露就绪
    let cam = null, app = null;
    let lastTargetY = null; // 上一帧目标高度（防上楼梯逐级变矮）
    const waitReady = async () => {
        for (let i = 0; i < 300; i++) {
            if (window.__ssplatCameraEntity && window.__ssplatApp) {
                cam = window.__ssplatCameraEntity;
                app = window.__ssplatApp;
                return true;
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        return false;
    };

    const onTick = () => {
        // 模式过滤：仅 fly / walk；?free=1 自由飞行豁免
        if (window.__ssplatFreeFly) return;
        const mode = window.__ssplatMode;
        if (mode !== 'fly' && mode !== 'walk') return;

        const col = window.__ssplatCollision;
        if (!cam || !col || typeof col.queryRay !== 'function') return;
        try {
            const p = cam.getPosition();

            // 1) 高度写死：多点下探取“最高落脚面”（相机四周 ±0.35m 共 5 个测点），
            //    避免楼梯/坡面单点命中低一层面导致越走越矮（iOS WebGPU 上尤其明显）。
            const OFF = [0, 0.35, -0.35, 0, 0];
            const OFZ = [0, 0, 0, 0.35, -0.35];
            let best = -Infinity;
            for (let k = 0; k < 5; k++) {
                const h = col.queryRay(p.x + OFF[k], p.y, p.z + OFZ[k], 0, -1, 0, DROP_RAY);
                if (h && typeof h.y === 'number' && h.y > best) best = h.y;
            }
            if (Number.isFinite(best)) {
                let target = best + EYE_HEIGHT;
                // 高度钳制：单帧最多下降 0.5m（下台阶平滑），防止行走控制器把相机逐帧压低
                if (lastTargetY !== null && target < lastTargetY - 0.5) {
                    target = lastTargetY - 0.5;
                }
                lastTargetY = target;
                if (Math.abs(p.y - target) > 0.005) {
                    cam.setPosition(p.x, target, p.z);
                }
            }

            // 2) 俯仰写死：水平 360°，上下 ±20°
            clampPitch(cam);
        } catch (err) { /* 单帧约束失败忽略 */ }
    };

    // 双保险循环：rAF 主循环 + 引擎 update 钩子（任一触发都校正，幂等）
    const rafLoop = () => { requestAnimationFrame(() => { onTick(); rafLoop(); }); };
    waitReady().then((ok) => {
        if (!ok) return;
        rafLoop();
        if (app && typeof app.on === 'function') {
            try { app.on('update', onTick); } catch (e) { /* 忽略 */ }
        }
    });
    window.__ssplatCamConstraint = true;
})();