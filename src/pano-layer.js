/**
 * pano-layer.js —— 相机出生点全景背景层
 * ------------------------------------------------------------
 * 在相机初始位置（settings.json cameras[0].initial.position）放置一个
 * 内部可透视的大球体，贴上 img/pano.jpg 等距柱状全景图。
 * 相机位于球内时，四周/上下均显示全景（作为入场环境背景）。
 *
 *   ?pano=0  关闭全景球
 *   ?pano=R  指定球半径（米，默认 55）
 *
 * 依赖 build.mjs 补丁暴露的：
 *   window.__ssplatApp    （AppBase，提供 loader 解析纹理）
 *   window.__ssplatPano   （Mesh / MeshInstance / StandardMaterial / SphereGeometry / Entity / CULLFACE_NONE）
 *   window.__ssplatCameraEntity（相机实体：距离球心 > R 时隐藏，避免球壁挡远景）
 */
(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('pano') === '0') return;
    const RADIUS = (() => { const r = parseFloat(params.get('pano')); return Number.isFinite(r) && r > 10 ? r : 55; })();

    let state = null; // { center:{x,y,z}, mat, ent, mi, done }
    let alive = false;

    const tick = () => {
        const app = window.__ssplatApp;
        const gl = window.__ssplatPano;
        const cam = window.__ssplatCameraEntity;
        if (!app || !gl || !cam) { setTimeout(tick, 300); return; }

        if (!state) {
            // 出生点：settings.json 首相机 initial.position
            fetch('./settings.json')
                .then((r) => r.json())
                .then((s) => {
                    const c = s.cameras && s.cameras[0] && s.cameras[0].initial && s.cameras[0].initial.position;
                    if (!c) { console.warn('[pano] settings.json 无 cameras[0].initial.position，使用默认原点'); }
                    init(app, gl, c ? { x: c[0], y: c[1], z: c[2] } : { x: 0, y: 0, z: 0 });
                })
                .catch((e) => console.warn('[pano] settings.json 读取失败：', e));
            state = null;
            setTimeout(tick, 300);
            return;
        }
        if (!state.done) { setTimeout(tick, 300); return; }

        // 相机 / 球心 距离：超出半径一半时球已不包裹相机，隐藏球体避免球壁挡远景
        if (!alive) { alive = true; }
        const p = cam.getPosition();
        const dx = p.x - state.center.x, dy = p.y - state.center.y, dz = p.z - state.center.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const vis = d < state.radius && state.ready;
        if (state.mi.enabled !== vis) { state.mi.enabled = vis; app.renderNextFrame = true; }
        setTimeout(tick, 500);
    };

    const init = (app, gl, center) => {
        // 纹理：img/pano.jpg（等距柱状）→ 引擎未注册 jpg handler，改用 Image + Texture 直传
        //       （与标注纹理已验证的 canvas 直传路径一致；jpg 无 alpha 通道，无透明黑块问题）
        const img = new Image();
        img.onload = () => {
            try {
                const dv = app.graphicsDevice;
                const tex = new gl.Texture(dv, {
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                    mipmaps: true,
                    minFilter: gl.FILTER_LINEAR_MIPMAP_LINEAR,
                    magFilter: gl.FILTER_LINEAR
                });
                tex.setSource(img);
                tex.upload();
                build(app, gl, center, tex);
            } catch (err) {
                console.warn('[pano] 纹理创建失败：', err);
            }
        };
        img.onerror = () => console.warn('[pano] 全景图加载失败：./img/pano.jpg');
        img.src = './img/pano.jpg';
    };

    const build = (app, gl, center, tex) => {
        // 材质：自发光贴图 + 无光照 + 双侧渲染（球内部可见）+ 不透明
        const mat = new gl.StandardMaterial();
        mat.emissiveMap = tex;
        mat.emissive.set(1, 1, 1);
        mat.useLighting = false;
        mat.cull = gl.CULLFACE_NONE;
        mat.update();

        // 球体网格
        const geom = new gl.SphereGeometry({ radius: RADIUS, widthSegments: 64, heightSegments: 32 });
        const mesh = gl.Mesh.fromGeometry(app.graphicsDevice, geom);
        const mi = new gl.MeshInstance(mesh, mat);

        const ent = new gl.Entity('pano-layer');
        ent.addComponent('render', { meshInstances: [mi] });
        ent.setPosition(center.x, center.y, center.z);
        app.root.addChild(ent);

        state = { center, mat, ent, mi, radius: RADIUS, ready: true, done: true };
        app.renderNextFrame = true;
        console.log('[pano] 全景球已就位 @', center.x.toFixed(2), center.y.toFixed(2), center.z.toFixed(2), 'R=' + RADIUS);
    };

    setTimeout(tick, 500);
})();