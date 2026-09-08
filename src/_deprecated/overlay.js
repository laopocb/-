/**
 * three.js 叠加层
 * ============================================================
 * 职责：
 *   1. 在 SuperSplat viewer 的 canvas 之上再叠一块透明 canvas（three 独立 WebGL 上下文），
 *      两个画布共享同一个相机：每帧从 viewer 的相机管理器读取位姿与 FOV，写进 three 相机；
 *   2. 读取 data/lx.geojson 的多边形，每个多边形沿竖直方向挤出 EXTRUDE_H 米，
 *      生成完整封闭几何体（顶面 + 底面 + 四周侧面），贴青色半透明网格纹理 + 亮青描边；
 *   3. canvas 设 pointer-events: none，鼠标/触摸操作全部透传给下层 viewer，交互不受影响。
 *
 * 坐标换算：
 *   viewer 里 splat 实体被绕 X 轴旋转了 -90°（Z-up → Y-up），因此数据坐标 (px, py, pz)
 *   在世界空间中的位置是 (px, pz, -py)。
 *   实现上：Shape 直接用 (px, py) 建在 XY 平面，挤出沿 +Z，再 rotateX(-90°) 即得到
 *   (px, t, -py)，最后沿 Y 平移到基准高度 baseY（= 该多边形顶点 z 的平均值）。
 *
 * URL 参数：
 *   ?polyh=2    挤出高度（米，默认 2）
 *   ?polyo=0.45 不透明度（默认 0.45）
 *   ?poly=0     隐藏多边形（只看 splat）
 *   ?polydebug=1 控制台输出相机管理器结构（排查相机同步用）
 */

import * as THREE from './vendor/three.module.js';

// ---------- 参数 ----------
const params = new URLSearchParams(location.search);
const numParam = (key, fallback) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
};

const EXTRUDE_H = numParam('polyh', 2); // 挤出高度（米）
const OPACITY = numParam('polyo', 0.45); // 半透明程度
const ENABLED = params.get('poly') !== '0'; // 总开关
const DEBUG = params.has('polydebug');
const GEOJSON_URL = params.get('geojson') || './data/lx.geojson';

const log = (...args) => { if (DEBUG) console.log('[overlay]', ...args); };

// ---------- 叠加画布 ----------
const viewerCanvas = document.getElementById('application-canvas');
const canvas = document.createElement('canvas');
canvas.id = 'three-overlay';
// 不设 z-index：靠 DOM 顺序叠在 viewer canvas 之上、官方 UI（#ui）之下
Object.assign(canvas.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none'
});
if (viewerCanvas && viewerCanvas.parentNode) {
    viewerCanvas.parentNode.insertBefore(canvas, viewerCanvas.nextSibling);
} else {
    document.body.appendChild(canvas);
}

const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0); // 完全透明，露出下层 splat

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 5000);

// 灯光（MeshStandardMaterial 需要；环境光打底 + 方向光出体积感）
scene.add(new THREE.AmbientLight(0xffffff, 1.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(0.6, 1, 0.4);
scene.add(dirLight);

// ---------- 青色半透明网格纹理（程序化生成，无外部图片依赖） ----------
const makeCyanGridTexture = () => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');

    // 底：淡青半透明
    ctx.fillStyle = 'rgba(0, 220, 220, 0.20)';
    ctx.fillRect(0, 0, size, size);

    // 亮青网格：外框 + 4×4 细分
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
    // ExtrudeGeometry 的 UV 用的是顶点坐标值（单位：米），repeat = 1/2 → 每 2 米一格
    texture.repeat.set(1 / 2, 1 / 2);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

const gridTexture = makeCyanGridTexture();

const bodyMaterial = new THREE.MeshStandardMaterial({
    map: gridTexture,
    color: 0x9ffff5,
    emissive: 0x0a3a3a,
    roughness: 0.55,
    metalness: 0,
    transparent: true,
    opacity: OPACITY,
    side: THREE.DoubleSide, // 里外都可见，避免绕向问题导致面消失
    depthWrite: false // 半透明叠加，不自遮挡
});

const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x66fff0,
    transparent: true,
    opacity: 0.9
});

// ---------- geojson → 挤出体 ----------
/**
 * 取多边形的顶点数组（Polygon 与 MultiPolygon 都只取第一个外环）。
 */
const polygonRings = (geometry) => {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates || [];
    if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).map((poly) => poly[0]);
    return [];
};

/**
 * 一个环 → 封闭挤出体（顶面 + 底面 + 四周侧面）。
 * 数据坐标 (px, py, pz) → 世界 (px, pz, -py)：Shape 用 (px, py)，挤出后 rotateX(-90°) 即可。
 */
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

    const baseY = baseYSum / ring.length; // 基准面高度 = 顶点 z 均值
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: EXTRUDE_H,
        bevelEnabled: false,
        curveSegments: 1
    });
    // (px, py, t) --rotateX(-90°)--> (px, t, -py)，再抬到基准高度
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
    log(`多边形 ${index}：${ring.length} 个顶点，基准高度 ${baseY.toFixed(3)}，挤出 ${EXTRUDE_H} m`);
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
            if (group) {
                scene.add(group);
                built += 1;
            }
        });
    });
    console.log(`[overlay] geojson 已加载：${features.length} 个要素 → ${built} 个挤出体（高度 ${EXTRUDE_H} m，透明度 ${OPACITY}）`);
};

// ---------- 相机同步 ----------
// viewer 的 CameraManager 内部结构不对外承诺，这里做多种可能路径的健壮探测。
let cameraEntity = null;
let probeDone = false;

const findCameraEntity = () => {
    const manager = window.__ssplatCameraManager;
    if (!manager) return null;

    const candidates = [manager.camera, manager.cameraEntity, manager._camera, manager.currentCamera, manager.entity];
    for (const candidate of candidates) {
        if (candidate && typeof candidate.getPosition === 'function' && candidate.camera) return candidate;
    }
    // 兜底：遍历自有属性，找带 camera 组件且能取位姿的对象
    for (const key of Object.keys(manager)) {
        const value = manager[key];
        if (value && typeof value === 'object' && typeof value.getPosition === 'function' && value.camera) {
            return value;
        }
    }
    return null;
};

const probeCameraManager = () => {
    if (probeDone) return;
    probeDone = true;
    const manager = window.__ssplatCameraManager;
    if (!DEBUG || !manager) return;
    console.log('[overlay] CameraManager 自有属性：', Object.keys(manager));
    const found = findCameraEntity();
    console.log('[overlay] 探测到的相机实体：', found);
    if (found && found.camera) {
        console.log('[overlay] camera 组件字段：', {
            fov: found.camera.fov,
            horizontalFov: found.camera.horizontalFov,
            nearClip: found.camera.nearClip,
            farClip: found.camera.farClip
        });
    }
};

const syncCamera = () => {
    if (!cameraEntity) {
        cameraEntity = findCameraEntity();
        if (cameraEntity) {
            probeCameraManager();
            log('相机实体已获取', cameraEntity);
        }
    }
    if (!cameraEntity) return false;

    const position = cameraEntity.getPosition();
    camera.position.set(position.x, position.y, position.z);

    const rotation = cameraEntity.getRotation();
    if (rotation) camera.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    const component = cameraEntity.camera;
    if (component) {
        let fov = typeof component.fov === 'number' ? component.fov : camera.fov;
        // PlayCanvas 支持水平 FOV，three 用垂直 FOV，两者按 aspect 换算
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

// ---------- 尺寸同步 ----------
const resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

// ---------- 主循环 ----------
let syncedOnce = false;
const tick = () => {
    requestAnimationFrame(tick);
    const ok = syncCamera();
    if (!ok && !syncedOnce) return; // 相机还没就绪时先不渲染，避免闪一帧错位画面
    syncedOnce = true;
    renderer.render(scene, camera);
};

if (ENABLED) {
    await loadPolygons();
    tick();
    window.__ssplatOverlay = { scene, camera, renderer, THREE }; // 便于控制台调试
    console.log('[overlay] three 叠加层已启动（?poly=0 隐藏，?polyh= 调高度，?polyo= 调透明度）');
}
