/**
 * ============================================================================
 *  c u s t o m . j s   ——  本页全部自定义叠加逻辑（唯一注入文件）
 * ============================================================================
 *  官方 SuperSplat Viewer 之上挂的所有增强都在这个文件里：
 *
 *   [A] 相机位姿日志（camlog）：默认每 1s 向 console 输出当前相机
 *       pos / target / fwd；键盘按 L 随时输出一条。?camlog=0 关闭，
 *       ?camlog=N 改间隔秒。
 *
 *   [B] three.js WebGL 叠加层（原 overlay.js）：在 viewer canvas 之上再叠
 *       一层透明 three canvas，读取 data/lx.geojson 多边形挤出成青色半透明
 *       网格体并实时同步相机；pointer-events:none 不挡交互。?poly=0 关闭。
 *
 *   [C] 三维点标注层（原 points-layer.js）：加载 data/dian.geojson 的 Point
 *       要素，数据坐标 (px,py,pz) → 世界 (px, pz+0.4, -py)（与挤出体同变换），
 *       每帧把 3D 点投影到屏幕 DOM 标签：视锥内显示蓝色编号圆点，视锥外/背后
 *       在屏幕边缘显示指向箭头；悬停高亮+标题，单击弹出信息卡（图片/名称/说明）。
 *       ?dian=0 关闭，?dian=./data/xxx.geojson 换文件。
 *
 *  全部功能默认在 http://127.0.0.1:8123/ 即加载，不需要任何 URL 参数。
 * ============================================================================
 */

import * as THREE from './vendor/three.module.js';

// ===========================================================================
// [A] 相机位姿日志 —— 默认开启
// ===========================================================================
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
            // 一次性一致性探测：entity 位姿 vs cameraManager 权威数据
            if (!window.__ssplatCamProbe) {
                window.__ssplatCamProbe = true;
                try {
                    const mgr = window.__ssplatCameraManager;
                    if (mgr && mgr.camera && mgr.camera.position) {
                        const mp = mgr.camera.position;
                        console.log('[cam] 一致性探测 entity vs cameraManager：',
                            'dx=' + fmt(mp.x - pos.x), 'dy=' + fmt(mp.y - pos.y), 'dz=' + fmt(mp.z - pos.z),
                            ' entity方法={getWorldRotation:' + (typeof cam.getWorldRotation) + ',getRotation:' + (typeof cam.getRotation) + '}');
                    } else {
                        console.log('[cam] 一致性探测：cameraManager 不可用', !!mgr);
                    }
                } catch (e) { console.warn('[cam] probe error:', e); }
            }
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
    console.log('[cam] 相机日志已开启：每 ' + iv + 's 输出一次，按 L 随时输出（?camlog=0 关闭）');
})();

// ===========================================================================
// [B] three.js WebGL 叠加层（lx.geojson 青色挤出体）
// ===========================================================================
(async () => {
    const params = new URLSearchParams(location.search);
    const numParam = (key, fallback) => {
        const raw = params.get(key);
        if (raw === null) return fallback;
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    };
    const EXTRUDE_H = numParam('polyh', 2);
    const OPACITY = numParam('polyo', 0.45);
    const ENABLED = params.get('poly') !== '0';
    const DEBUG = params.has('polydebug');
    const GEOJSON_URL = params.get('geojson') || './data/lx.geojson';
    const log = (...args) => { if (DEBUG) console.log('[overlay]', ...args); };

    const viewerCanvas = document.getElementById('application-canvas');
    const canvas = document.createElement('canvas');
    canvas.id = 'three-overlay';
    Object.assign(canvas.style, {
        position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
        pointerEvents: 'none'
    });
    if (viewerCanvas && viewerCanvas.parentNode) {
        viewerCanvas.parentNode.insertBefore(canvas, viewerCanvas.nextSibling);
    } else {
        document.body.appendChild(canvas);
    }

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 5000);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(0.6, 1, 0.4);
    scene.add(dirLight);

    const makeCyanGridTexture = () => {
        const size = 256;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgba(0, 220, 220, 0.20)';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = 'rgba(150, 255, 250, 0.85)';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, size, size);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 1; i < 4; i += 1) {
            const p = (i * size) / 4;
            ctx.moveTo(p, 0); ctx.lineTo(p, size);
            ctx.moveTo(0, p); ctx.lineTo(size, p);
        }
        ctx.stroke();
        const texture = new THREE.CanvasTexture(c);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1 / 2, 1 / 2);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    };
    const bodyMaterial = new THREE.MeshStandardMaterial({
        map: makeCyanGridTexture(), color: 0x9ffff5, emissive: 0x0a3a3a,
        roughness: 0.55, metalness: 0, transparent: true, opacity: OPACITY,
        side: THREE.DoubleSide, depthWrite: false
    });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x66fff0, transparent: true, opacity: 0.9 });

    const polygonRings = (geometry) => {
        if (!geometry) return [];
        if (geometry.type === 'Polygon') return geometry.coordinates || [];
        if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).map((poly) => poly[0]);
        return [];
    };

    const buildExtrudedMesh = (ring, index) => {
        if (!Array.isArray(ring) || ring.length < 3) return null;
        const shape = new THREE.Shape();
        let baseYSum = 0;
        ring.forEach((point, i) => {
            const [px, py, pz] = point;
            baseYSum += typeof pz === 'number' ? pz : 0;
            if (i === 0) shape.moveTo(px, py);
            else shape.lineTo(px, py);
        });
        shape.closePath();
        const baseY = baseYSum / ring.length;
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: EXTRUDE_H, bevelEnabled: false, curveSegments: 1 });
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, baseY, 0);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, bodyMaterial);
        mesh.name = `polygon-${index}`;
        mesh.renderOrder = 2;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), edgeMaterial);
        edges.name = `polygon-edges-${index}`;
        edges.renderOrder = 3;
        const group = new THREE.Group();
        group.add(mesh, edges);
        return group;
    };

    const loadPolygons = async () => {
        let geojson;
        try {
            const response = await fetch(GEOJSON_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            geojson = await response.json();
        } catch (err) {
            console.error('[overlay] geojson 加载失败：', err);
            return;
        }
        const features = Array.isArray(geojson.features) ? geojson.features : [];
        let built = 0;
        features.forEach((feature, featureIndex) => {
            const rings = polygonRings(feature.geometry);
            rings.forEach((ring, ringIndex) => {
                const group = buildExtrudedMesh(ring, `${featureIndex}-${ringIndex}`);
                if (group) { scene.add(group); built += 1; }
            });
        });
        console.log(`[overlay] geojson 已加载：${features.length} 个要素 → ${built} 个挤出体（高度 ${EXTRUDE_H} m，透明度 ${OPACITY}）`);
    };

    // 相机同步：优先用暴露的 camera entity；找不到再探测 CameraManager
    let cameraEntity = null;
    const findCameraEntity = () => {
        const direct = window.__ssplatCameraEntity;
        if (direct && typeof direct.getPosition === 'function') return direct;
        const manager = window.__ssplatCameraManager;
        if (!manager) return null;
        const candidates = [manager.camera, manager.cameraEntity, manager._camera, manager.currentCamera, manager.entity];
        for (const candidate of candidates) {
            if (candidate && typeof candidate.getPosition === 'function' && candidate.camera) return candidate;
        }
        for (const key of Object.keys(manager)) {
            const value = manager[key];
            if (value && typeof value === 'object' && typeof value.getPosition === 'function' && value.camera) return value;
        }
        return null;
    };

    const syncCamera = () => {
        if (!cameraEntity) {
            cameraEntity = findCameraEntity();
            if (cameraEntity) log('相机实体已获取', cameraEntity);
        }
        if (!cameraEntity) return false;
        const position = cameraEntity.getPosition();
        camera.position.set(position.x, position.y, position.z);
        const rotation = cameraEntity.getRotation();
        if (rotation) camera.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        const component = cameraEntity.camera;
        if (component) {
            let fov = typeof component.fov === 'number' ? component.fov : camera.fov;
            if (component.horizontalFov) {
                const halfH = (fov * Math.PI) / 360;
                fov = (2 * Math.atan(Math.tan(halfH) / camera.aspect) * 180) / Math.PI;
            }
            camera.fov = fov;
            if (typeof component.nearClip === 'number') camera.near = component.nearClip;
            if (typeof component.farClip === 'number') camera.far = Math.max(component.farClip, 10);
        }
        camera.updateProjectionMatrix();
        return true;
    };

    const resize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();

    let syncedOnce = false;
    const tick = () => {
        requestAnimationFrame(tick);
        const ok = syncCamera();
        if (!ok && !syncedOnce) return;
        syncedOnce = true;
        renderer.render(scene, camera);
    };

    if (ENABLED) {
        await loadPolygons();
        tick();
        window.__ssplatOverlay = { scene, camera, renderer, THREE };
        console.log('[overlay] three 叠加层已启动（?poly=0 隐藏，?polyh= 调高度，?polyo= 调透明度）');
    }
})();

// ===========================================================================
// [C] 三维点标注层（dian.geojson → DOM 标签）
// ===========================================================================
(async () => {
    const params = new URLSearchParams(location.search);
    const DEFAULT_DIAN_URL = './data/dian.geojson';
    const rawDian = params.get('dian');
    const GEOJSON_URL = (rawDian !== null && rawDian !== '0' && !/xxx|yyy/.test(rawDian)) ? rawDian : DEFAULT_DIAN_URL;
    const LAYER_DISABLED = rawDian === '0';

    if (LAYER_DISABLED) {
        console.log('[points] 已关闭（?dian=0）');
        return;
    }
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
        pointerEvents: 'auto', zIndex: '1100', overflow: 'hidden', backdropFilter: 'blur(8px)'
    });
    card.innerHTML = `
        <div class="pt-card-img" style="width:100%;aspect-ratio:16/9;background:#000 center/cover no-repeat;"></div>
        <div style="padding:18px 20px 20px;">
            <div class="pt-card-title" style="font-size:18px;font-weight:600;margin-bottom:8px;"></div>
            <div class="pt-card-desc" style="font-size:13px;line-height:1.6;color:#bbb;margin-bottom:16px;"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="pt-card-align" style="background:#34c759;color:#fff;border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;">对准当前视角</button>
                <button class="pt-card-fly" style="background:#0a84ff;color:#fff;border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;">飞到此处</button>
                <button class="pt-card-close" style="background:transparent;color:#aaa;border:1px solid #444;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(card);
    card.querySelector('.pt-card-close').addEventListener('click', () => card.classList.add('hidden'));
    card.addEventListener('click', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') card.classList.add('hidden'); });
    layer.addEventListener('click', () => card.classList.add('hidden'));

    // ---------- 标注数据 ----------
    const points = [];
    // dian.geojson 坐标 = viewer 世界坐标（与 camlog 的 pos/target 同一坐标系，1:1）。
    // 不做任何数据→世界变换，避免坐标映射猜测误差；标签精确落在用户参考 target。
    const dataToWorld = (px, py, pz) => ({ x: px, y: py, z: pz });

    const makeLabel = (pt) => {
        const el = document.createElement('div');
        el.className = 'pt-label';
        Object.assign(el.style, {
            position: 'absolute', left: '0', top: '0',
            transform: 'translate3d(-9999px,-9999px,0)',
            pointerEvents: 'auto', cursor: 'pointer', userSelect: 'none', willChange: 'transform'
        });
        el.innerHTML = `
            <div class="pt-arrow" style="position:absolute;left:50%;top:50%;width:26px;height:26px;
                transform:translate(-50%,-50%) rotate(45deg);opacity:0;pointer-events:none;transition:opacity .12s ease;
                border-top:3px solid #0a84ff;border-right:3px solid #0a84ff;
                filter:drop-shadow(0 0 4px rgba(10,132,255,0.7));"></div>
            <div class="pt-dot" style="width:34px;height:34px;border-radius:50%;background:rgba(10,132,255,0.85);
                border:2px solid #fff;display:flex;align-items:center;justify-content:center;
                color:#fff;font-weight:700;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,0.4);
                transition:transform .15s ease, opacity .15s ease;">${pt.num}</div>
            <div class="pt-cap" style="position:absolute;left:42px;top:50%;transform:translateY(-50%);
                background:rgba(10,14,22,0.92);color:#fff;padding:6px 10px;border-radius:8px;
                font-size:13px;white-space:nowrap;opacity:0;transition:opacity .15s ease;
                border:1px solid rgba(255,255,255,0.08);pointer-events:none;">
                <div>${pt.title}</div>
                <div style="font-size:11px;color:#7fd4ff;margin-top:2px;">@${pt.world.x.toFixed(2)}, ${pt.world.y.toFixed(2)}, ${pt.world.z.toFixed(2)}</div>
            </div>
        `;
        const dot = el.querySelector('.pt-dot');
        const cap = el.querySelector('.pt-cap');
        const arrow = el.querySelector('.pt-arrow');
        el.addEventListener('mouseenter', () => { dot.style.transform = 'scale(1.18)'; cap.style.opacity = '1'; });
        el.addEventListener('mouseleave', () => { dot.style.transform = 'scale(1)'; cap.style.opacity = '0'; });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            card.querySelector('.pt-card-img').style.backgroundImage = `url('./data/点位/${pt.image}')`;
            card.querySelector('.pt-card-title').textContent = `${pt.num}. ${pt.title}`;
            card.querySelector('.pt-card-desc').textContent = pt.desc;
            card.classList.remove('hidden');
            // 「对准当前视角」：把该点挪到相机正前方 10m 的世界位置（即 camera target）
            const alignBtn = card.querySelector('.pt-card-align');
            alignBtn.onclick = () => {
                const cam = window.__ssplatCameraEntity;
                if (!cam) return;
                const p = cam.getPosition();
                const q = (typeof cam.getWorldRotation === 'function') ? cam.getWorldRotation()
                    : (typeof cam.getRotation === 'function' ? cam.getRotation() : null);
                if (!q) return;
                const fx = -(2 * (q.x * q.z + q.y * q.w));
                const fy = 2 * (q.x * q.w - q.y * q.z);
                const fz = 2 * (q.x * q.x + q.y * q.y) - 1;
                // 优先：碰撞体射线命中模型表面（保证贴模型）；无碰撞/未命中：退回正前方 10m
                let hx = p.x + fx * 10, hy = p.y + fy * 10, hz = p.z + fz * 10;
                let mode = 'fallback10m';
                try {
                    const col = window.__ssplatCollision;
                    if (col && typeof col.queryRay === 'function') {
                        const hit = col.queryRay(p.x, p.y, p.z, fx, fy, fz, 500);
                        if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y) && Number.isFinite(hit.z)) {
                            hx = hit.x; hy = hit.y; hz = hit.z; mode = 'rayhit';
                        } else {
                            console.warn('[points] 射线未命中表面或命中字段异常（字段=', hit && Object.keys(hit), '），退回 10m');
                        }
                    } else {
                        console.warn('[points] 无碰撞体（__ssplatCollision）可用，退回 10m 对准');
                    }
                } catch (err) { console.warn('[points] 射线贴面失败：', err); }
                pt.world.x = hx; pt.world.y = hy; pt.world.z = hz;
                console.log(`[points] 已把「${pt.num}. ${pt.title}」对准（${mode}）：world=(${hx.toFixed(2)}, ${hy.toFixed(2)}, ${hz.toFixed(2)}) — 刷新会丢，请同步 data/dian.geojson`);
                card.classList.add('hidden');
            };
            const flyBtn = card.querySelector('.pt-card-fly');
            flyBtn.onclick = () => {
                const cam = window.__ssplatCameraEntity;
                if (!cam) return;
                const camPos = cam.getPosition();
                const dx = pt.world.x - camPos.x, dy = pt.world.y - camPos.y, dz = pt.world.z - camPos.z;
                const len = Math.hypot(dx, dy, dz) || 1;
                const standOff = 4;
                cam.setPosition?.(pt.world.x - dx / len * standOff, pt.world.y - dy / len * standOff, pt.world.z - dz / len * standOff);
                cam.lookAt?.(pt.world);
                card.classList.add('hidden');
            };
        });
        layer.appendChild(el);
        return el;
    };

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
            points.forEach((pt) => layer.appendChild(makeLabel(pt)));
            window.__ssplatPointsList = points; // 供 [D] 3D 标签层共享同一数据（对准改动即时生效）
            window.__ssplatPoints = { type: 'loaded', count: points.length, source: url };
            console.log(`[points] 标注已加载：${points.length} 个  ←  ${url}`);
        } catch (err) {
            window.__ssplatPoints = { type: 'error', count: 0, message: String(err && err.message || err) };
            console.warn('[points] GeoJSON 加载失败：', err);
        }
    })();

    // ---------- 每帧投影 ----------
    const rotateByQuat = (v, qx, qy, qz, qw) => ({
        x: v.x * (1 - 2 * (qy * qy + qz * qz)) + v.y * 2 * (qx * qy - qz * qw) + v.z * 2 * (qx * qz + qy * qw),
        y: v.x * 2 * (qx * qy + qz * qw) + v.y * (1 - 2 * (qx * qx + qz * qz)) + v.z * 2 * (qy * qz - qx * qw),
        z: v.x * 2 * (qx * qz - qy * qw) + v.y * 2 * (qy * qz + qx * qw) + v.z * (1 - 2 * (qx * qx + qy * qy))
    });

    let __lastDiag = 0, __loggedNoCam = false;
    const stableModes = {}; // 每点模式迟滞（防视锥边界抖动）
    const diag = { lastModes: [], lastDist: [], lastScreen: [], lastWorld: [] };

    const tick = () => {
        requestAnimationFrame(tick);
        const cam = window.__ssplatCameraEntity;
        if (!cam || points.length === 0) {
            if (!__loggedNoCam && points.length > 0) {
                console.warn('[points] 相机未就绪 __ssplatCameraEntity=', !!cam);
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
            console.warn('[points] 相机读数异常：', err);
            return;
        }
        const fovRad = fov * Math.PI / 180;
        const aspect = window.innerWidth / window.innerHeight;
        // 官方相机 horizontalFov=true 时 fov 是水平视场角（宽屏场景常见）；
        // 垂直半角必须由水平半角 ÷ aspect 得出，否则纵向被压缩 → 标签与实物纵向错位
        const tanH = horizontalFov ? Math.tan(fovRad / 2) : Math.tan(fovRad / 2) * aspect;
        const tanV = horizontalFov ? tanH / aspect : Math.tan(fovRad / 2);

        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        const els = layer.querySelectorAll('.pt-label');
        let visible = 0;
        els.forEach((el, i) => {
            const p = points[i];
            if (!p) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; return; }
            const dot = el.querySelector('.pt-dot');
            const arrow = el.querySelector('.pt-arrow');
            const rel = { x: p.world.x - pos.x, y: p.world.y - pos.y, z: p.world.z - pos.z };
            const local = rotateByQuat(rel, -q.x, -q.y, -q.z, q.w);

            let mode, sx, sy, ndcX, ndcY, depthScale;
            if (local.z >= -0.05) {
                mode = 'behind';
                sx = cx;
                sy = window.innerHeight - 64 - i * 36;
                ndcX = (sx - cx) / cx;
                ndcY = -(sy - cy) / cy;
                depthScale = 1;
            } else {
                ndcX = local.x / (-local.z) / tanH;
                ndcY = local.y / (-local.z) / tanV;
                const aX = Math.abs(ndcX), aY = Math.abs(ndcY);
                // 迟滞判定：避免点在视锥边界时 in/edge 反复切换导致闪烁（“抽风”）
                const prev = stableModes[i];
                let rawMode = (aX <= 1.05 && aY <= 1.05) ? 'in' : 'edge';
                if (prev === 'in' && rawMode === 'edge' && aX <= 1.35 && aY <= 1.35) rawMode = 'in';
                if (prev === 'edge' && rawMode === 'in' && (aX > 0.82 || aY > 0.82)) rawMode = 'edge';
                stableModes[i] = rawMode;
                if (rawMode === 'in') {
                    mode = 'in';
                    sx = cx + ndcX * cx;
                    sy = cy - ndcY * cy;
                    depthScale = Math.max(0.7, Math.min(1.3, 10 / (-local.z)));
                    visible += 1;
                } else {
                    mode = 'edge';
                    const ax = aX, ay = aY;
                    const k = 0.92 / Math.max(ax, ay);
                    ndcX *= k; ndcY *= k;
                    sx = cx + ndcX * cx;
                    sy = cy - ndcY * cy;
                    depthScale = Math.max(0.55, Math.min(1, 14 / (-local.z)));
                }
            }
            diag.lastModes[i] = mode;
            diag.lastDist[i] = -local.z;
            diag.lastScreen[i] = { x: sx, y: sy };
            diag.lastWorld[i] = p.world;

            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
            el.style.transform = `translate3d(${sx - 17}px, ${sy - 17}px, 0) scale(${depthScale.toFixed(2)})`;
            el.style.zIndex = String(mode === 'in' ? (1500 - Math.floor(-local.z)) : (1490 + (mode === 'behind' ? i : 0)));

            // 视觉由 [D] 3D 标签接管：in/edge 都不显示 DOM 圆点（常显 3D 横幅，防抖动）；
            // 仅 behind（相机背后）显示 DOM 底部箭头提示转向
            const _3dActive = !!window.__ssplat3DReady;
            if (_3dActive) {
                dot.style.opacity = '0';
                arrow.style.opacity = mode === 'behind' ? '1' : '0';
                if (mode === 'behind') arrow.style.transform = 'translate(-50%,-50%) rotate(225deg)';
            } else if (mode === 'in') {
                dot.style.opacity = '1';
                arrow.style.opacity = '0';
            } else if (mode === 'edge') {
                dot.style.opacity = '0.35';
                arrow.style.opacity = '1';
                const ang = Math.atan2(-ndcY, ndcX) * 180 / Math.PI;
                arrow.style.transform = `translate(-50%,-50%) rotate(${ang}deg)`;
            } else {
                dot.style.opacity = '0.25';
                arrow.style.opacity = '1';
                arrow.style.transform = 'translate(-50%,-50%) rotate(225deg)';
            }
        });
        window.__ssplatPointsVisible = visible;
        window.__ptsModes = diag.lastModes.slice(); // 供 [D] 3D 标签同步显隐

        const now = performance.now();
        if (now - __lastDiag > 1000) {
            __lastDiag = now;
            const summary = diag.lastModes.map((m, i) => {
                const w = diag.lastWorld[i];
                return `${i + 1}:${m}@${(diag.lastDist[i] || 0).toFixed(1)}m(${Math.round(diag.lastScreen[i]?.x || 0)},${Math.round(diag.lastScreen[i]?.y || 0)})` +
                    (w ? `[${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)}]` : '');
            }).join(' | ');
            console.log(`[points] viewport=${window.innerWidth}x${window.innerHeight} fov=${Math.round(fov)}${horizontalFov ? '(H)' : '(V)'}  ${summary}  visible=${visible}/${points.length}`);
        }
    };
    requestAnimationFrame(tick);
})();

// ===========================================================================
// [D] 3D 标签精灵 —— 注入 viewer 同一 WebGL 场景
// ===========================================================================
// 标签作为真实 3D 对象渲染进官方场景（与高斯同一相机/深度空间）：
//   - 每帧位置 = 标注点世界坐标 + 朝相机方向 0.35m（贴模型表面正前方，不嵌进模型）
//   - 自动 billboard：朝向相机，文字始终可读
//   - 视锥外/被相机绕到背后时隐藏实体；scale 固定世界尺寸（1.6m 横幅），近大远小自然透视
// 注：3DGS 高斯点云不写深度缓冲，精确“像素级被遮挡”由点云渲染特性决定；
//     本方案保证标签不嵌模型、不在模型内侧，浏览时贴合表面。
(async () => {
    const BANNER_W = 1.6; // 横幅宽（米）
    const BANNER_H = 0.55; // 横幅高（米）
    const FACE_OFFSET = 0.35; // 贴面外凸（米）

    // 画横幅纹理：左侧蓝底圆数字 + 右侧深色底标题
    const makeBannerTexture = (device, eng, num, title) => {
        const W = 1024, H = 320;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, W, H);

        // 主底：圆角深色板
        const r = 26;
        const round = (x, y, w, h) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        };
        ctx.fillStyle = 'rgba(12, 16, 24, 0.88)';
        round(0, 0, W, H); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 6; round(3, 3, W - 6, H - 6); ctx.stroke();

        // 左侧圆形徽章
        const cx = 118, cy = H / 2, R = 106;
        ctx.fillStyle = '#0a84ff';
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 10; ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 150px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(num), cx, cy + 8);

        // 标题
        ctx.fillStyle = '#f2f6fa';
        ctx.font = 'bold 62px "PingFang SC","Microsoft YaHei",Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(title.length > 18 ? title.slice(0, 18) + '…' : title, 268, H / 2 + 4);

        const tex = new eng.Texture(device, { width: W, height: H, mipmaps: false });
        tex.setSource(c);
        return tex;
    };

    const makeQuadMesh = (eng, device) => {
        const mesh = new eng.Mesh(device);
        const x = 0.5, y = 0.5;
        mesh.setPositions([-x, -y, 0, x, -y, 0, -x, y, 0, x, y, 0]);
        mesh.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
        mesh.setUvs(0, [0, 0, 1, 0, 0, 1, 1, 1]);
        mesh.setIndices([0, 2, 1, 1, 2, 3]);
        mesh.update();
        return mesh;
    };

    // 等依赖就绪
    const ready = async () => {
        for (let i = 0; i < 200; i++) {
            if (window.__ssplatEngine && window.__ssplatApp && window.__ssplatPointsList && window.__ssplatPointsList.length && window.__ssplatCollision) {
                return true;
            }
            await new Promise((r) => setTimeout(r, 150));
        }
        return false;
    };
    if (!(await ready())) {
        console.warn('[label3d] 依赖未就绪，跳过 3D 标签（engine/app/标注数据/碰撞体）');
        return;
    }
    const eng = window.__ssplatEngine;
    const app = window.__ssplatApp;
    const points = window.__ssplatPointsList;
    const device = app.graphicsDevice;

    const items = points.map((pt, i) => {
        const tex = makeBannerTexture(device, eng, pt.num, pt.title);
        const mesh = makeQuadMesh(eng, device);
        const mat = new eng.StandardMaterial();
        mat.diffuse = new eng.Color(0.15, 0.18, 0.24);
        mat.diffuseMap = tex;
        mat.emissive = new eng.Color(1, 1, 1);
        mat.emissiveMap = tex;
        mat.useLighting = false;
        mat.cull = 0; // CULLFACE_NONE
        mat.update();
        const inst = new eng.MeshInstance(mesh, mat);
        const entity = new eng.Entity(`pt3d-${i}`);
        entity.addComponent('render', { meshInstances: [inst] });
        app.root.addChild(entity);
        entity.setLocalScale(BANNER_W, BANNER_H, 1);
        return { pt, entity, tex, mat, visible: false };
    });
    window.__ssplat3DReady = true;
    console.log(`[label3d] 3D 标签已注入场景：${items.length} 个（贴面 ${FACE_OFFSET}m，横幅 ${BANNER_W}x${BANNER_H}m）`);

    // +Z → 朝目标方向的四元数（手动 LookRotation，避免依赖引擎 API）
    const quatLookZ = (dx, dy, dz) => {
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-6) return { x: 0, y: 0, z: 0, w: 1 };
        dx /= len; dy /= len; dz /= len;
        // 求 +Z(0,0,1) 旋转到 d 的四元数
        const dot = dz; // cosθ
        const ax = -dy, ay = dx; // cross((0,0,1), d) = (0*dz-1*dy, 1*dx-0*dz, 0)=(-dy, dx, 0)
        const alen = Math.hypot(ax, ay);
        if (alen < 1e-7) {
            // d 与 +Z 平行或反平行
            if (dot > 0) return { x: 0, y: 0, z: 0, w: 1 };
            return { x: 1, y: 0, z: 0, w: 0 }; // 180° 绕 X
        }
        const c = Math.sqrt(Math.max(0, (1 + dot) / 2));
        const s = Math.sqrt(Math.max(0, (1 - dot) / 2));
        return { x: ax / alen * s, y: ay / alen * s, z: 0 * s, w: c };
    };

    const tick = () => {
        requestAnimationFrame(tick);
        const cam = window.__ssplatCameraEntity;
        if (!cam) return;
        let camPos;
        try { camPos = cam.getPosition(); } catch (e) { return; }
        const modes = window.__ptsModes || [];
        items.forEach((it, i) => {
            // 永远显示（behind/in/edge 一律渲染），背后时 banner 出现在屏幕中央朝相机，
            // 用户任何视角都能看到文字提示，体感"哪里都有标签"，杜绝"屏幕空"误判
            if (!it.visible) { it.entity.enabled = true; it.visible = true; }
            void modes[i]; // 保留 mode 数组用于后续可能的样式变化
            const w = it.pt.world;
            // 位置 = 标注点 + 朝相机方向偏移 FACE_OFFSET（贴模型观测面正前方）
            let ox = camPos.x - w.x, oy = camPos.y - w.y, oz = camPos.z - w.z;
            const l = Math.hypot(ox, oy, oz) || 1;
            ox /= l; oy /= l; oz /= l;
            it.entity.setPosition(w.x + ox * FACE_OFFSET, w.y + oy * FACE_OFFSET, w.z + oz * FACE_OFFSET);
            // billboard：横幅面(+Z)朝向相机
            const q = quatLookZ(camPos.x - (w.x + ox * FACE_OFFSET), camPos.y - (w.y + oy * FACE_OFFSET), camPos.z - (w.z + oz * FACE_OFFSET));
            it.entity.setRotation(q.x, q.y, q.z, q.w);
        });
    };
    requestAnimationFrame(tick);
})();
