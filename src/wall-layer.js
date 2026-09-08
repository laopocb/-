/**
 * wall-layer.js —— 空气墙模型层（原 polygon-layer：geojson 青色挤出体已废弃，改为加载 1.obj 模型）
 * -----------------------------------------------------------------------------------------------
 * 职责：
 *   1. 在 viewer canvas 之上叠一层透明 three canvas，加载 data/1.obj（三维建筑模型）作为"空气墙"，
 *      填充青色不透明材质（双面）+ 青色描边，每帧与 viewer 相机同步；
 *   2. 坐标校正：1.obj = 世界坐标 × 100（obj.x→本地x、obj.y→高度、obj.z→-本地y，与 lx.geojson
 *      及世界坐标完全吻合），整体除以 100 即为世界坐标，模型自身带高度（不做平面化）；
 *   3. pointer-events:none 不挡交互，与高斯渲染完全解耦。
 *
 * URL 参数：
 *   ?wall=1          显示空气墙模型（当前默认隐藏=完全透明；?wall 不带 = 不显示）
 *   ?wallfile=       换 obj（默认 ./data/1.obj）
 *   ?wscale=s        整体缩放（默认 1）
 *   ?wshift=x,y,z    平移（米，默认 0,0,0）
 *   ?wraw=1          不校正（按 obj 原始坐标显示，调试用）
 */
import * as THREE from './vendor/three.module.js';

(async () => {
    const params = new URLSearchParams(location.search);
    const ENABLED = params.get('wall') === '1'; // 完全透明：默认不渲染空气墙可见层（碰撞/判定不受影响）
    const OBJ_URL = params.get('wallfile') || './data/1.obj';
    const RAW = params.get('wraw') === '1';
    const numParam = (key, fallback) => {
        const raw = params.get(key);
        if (raw === null) return fallback;
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    };
    const SCALE = numParam('wscale', 1);
    const rawShift = params.get('wshift') || '0,0,0';
    const SHIFT = rawShift.split(',').map(Number);
    if (!ENABLED) return;

    // ---------- 叠加画布（透明层，不挡交互） ----------
    const viewerCanvas = document.getElementById('application-canvas');
    const canvas = document.createElement('canvas');
    canvas.id = 'wall-overlay';
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

    // ---------- 青色半透明材质（空气墙主体 10% 不透明度 + 半透明描边） ----------
    const bodyMaterial = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.1, // 半透明 10%（相比不透明减少 90%）
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x66fff0, transparent: true, opacity: 0.6 });

    // ---------- 1.obj 解析（v + f，f 支持任意 n 边形 fan 三角化） ----------
    const parseObj = (text) => {
        const verts = [];
        const polys = [];
        text.split(/\r?\n/).forEach((line) => {
            const t = line.trim();
            if (t.startsWith('v ')) {
                const p = t.split(/\s+/).slice(1, 4).map(Number);
                if (p.length === 3 && p.every(Number.isFinite)) verts.push(p);
            } else if (t.startsWith('f ')) {
                const idx = t.split(/\s+/).slice(1)
                    .map((s) => parseInt(s.split('/')[0], 10))
                    .filter((n) => Number.isFinite(n) && n !== 0);
                if (idx.length >= 3) {
                    const abs = idx.map((n) => (n > 0 ? n - 1 : verts.length + n));
                    polys.push(abs);
                }
            }
        });
        return { verts, polys };
    };

    // 坐标校正：1.obj = MAX 坐标 × 100（obj 三维 = (MAX.x, MAX高度, -MAX.y)）。
    // MAX→高斯系 = 【纯平移 + 每轴独立缩放】（零旋转，避免把模型转斜）；
    // 常量由 7 组手工校对对应点最小二乘拟合（三维 RMS 0.14m，三轴缩放≈1.007）。
    const S = [1.0075, 1.0066, 1.0074];
    const T = [-33.5832, -1.8542, 44.6125];
    const transform = (p) => {
        const w = [
            (p[0] / 100) * SCALE + (SHIFT[0] || 0),
            (p[1] / 100) * SCALE + (SHIFT[1] || 0),
            (p[2] / 100) * SCALE + (SHIFT[2] || 0)
        ];
        return new THREE.Vector3(
            S[0] * w[0] + T[0],
            S[1] * w[1] + T[1],
            S[2] * w[2] + T[2]
        );
    };

    const loadObj = async () => {
        const res = await fetch(OBJ_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const { verts, polys } = parseObj(await res.text());
        if (!verts.length || !polys.length) throw new Error('obj 无可解析顶点/面');

        const positions = RAW ? verts.map((p) => new THREE.Vector3(p[0], p[1], p[2])) : verts.map(transform);
        const posArr = [];
        const idxArr = [];
        polys.forEach((poly) => {
            for (let i = 1; i < poly.length - 1; i++) {
                idxArr.push(poly[0], poly[i], poly[i + 1]);
            }
        });
        positions.forEach((v) => posArr.push(v.x, v.y, v.z));

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
        geometry.setIndex(idxArr);
        geometry.computeVertexNormals();

        const mesh = new THREE.Mesh(geometry, bodyMaterial);
        mesh.renderOrder = 2;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), edgeMaterial);
        edges.renderOrder = 3;
        const group = new THREE.Group();
        group.add(mesh, edges);
        scene.add(group);
    };

    // ---------- 相机同步（与旧 polygon-layer 相同） ----------
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
    tick();

    // ---------- 加载 obj（失败不打扰控制台：静默） ----------
    try {
        await loadObj();
    } catch (err) {
        // 静默失败（不打断主流程）
    }
})();