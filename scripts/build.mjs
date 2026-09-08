/**
 * 构建脚本：把官方 @playcanvas/supersplat-viewer 的静态查看器组装到 dist/
 * --------------------------------------------------------------------------
 * 官方 npm 包的 public/ 目录直接提供完整静态查看器（index.html / index.js / index.css），
 * 无需打包器，只需复制 + 打补丁。
 *
 * index.html 补丁：
 *   H1. 早期参数解析脚本：?flip=0 / ?rot=x,y,z（默认翻转，官方脚本执行前注入）；
 *   H2. 页面标题与品牌文案 → 「高斯查看器」；
 *   H3. 移除顶部注解导航条（Annotation Navigator）与 annotationInfo（永不显示）；
 *   H4. 空 favicon（消除 404）；
 *   H5. 默认 contentUrl → ./data/wd.compressed.ply；
 *   H6. 默认 collisionUrl → ./data/1.collision.glb（1.obj 空气墙碰撞体；?collision= 可覆盖）；
 *   H7. 注入功能模块脚本（camlog / wall-layer / annotations-poster），按功能拆分（1 功能 = 1 文件）；
 *       点位标注统一走官方原生 annotations（settings.json）。
 *
 * index.js 补丁：
 *   J1. 坐标系旋转可配置：默认 (-90,0,0)（Z-up→Y-up）；?flip=0 → 官方 (0,0,180)；?rotx,y,z 自定义；
 *   J2. 暴露相机管理器 / app / 相机实体（camlog/wall/poster 每帧同步相机用）；
 *   J3. 删除默认自动旋转/巡游动画（静态展示；?anim=1 恢复）；
 *   J4. 默认开启空气墙碰撞（上下左右不穿模）：相机挂 1.obj 碰撞体；?free=1 临时自由飞行；
 *       碰撞体数据常加载并暴露 __ssplatCollision（注解遮挡点击判定用）；
 *   J5. ?coldbg=1 自动开碰撞高亮（对照用）；
 *   J6. 默认相机模式：带碰撞 fly；?free=1 → 无碰撞自由飞；?mode= 可强制；
 *   J7. 官方注解常显：hidden 仅保留 Show Annotations 手动开关；
 *   J8. 注解点击防御：annotation.camera 未配置时不跳相机、不崩溃（浮云框大图交互）；
 *   J9. 遮挡判定：视线被空气墙碰撞体阻挡时记录 this._occluded（供点击拦截），不隐藏圆点；
 *   J10. 吞掉 requestPointerLock 的 promise reject（退出锁定后立即重进会抛 SecurityError）。
 *
 * 资源复制：
 *   - src/camlog.js / wall-layer.js / annotations-poster.js → dist/
 *   - node_modules/three/build/*.js → dist/vendor/（three ESM 运行时）
 *
 * 数据文件不复制到 dist：scripts/serve.mjs 直接把 /data/* 映射到项目根 data/ 目录（零拷贝）。
 *
 * 用法：node scripts/build.mjs
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url))); // D:\lm\w
const PKG_PUBLIC = join(ROOT, 'node_modules', '@playcanvas', 'supersplat-viewer', 'public');
const SRC_DIR = join(ROOT, 'src');
const DIST_DIR = join(ROOT, 'dist');
const VENDOR_DIR = join(DIST_DIR, 'vendor');
const THREE_BUILD = join(ROOT, 'node_modules', 'three', 'build');

const VIEWER_FILES = ['index.html', 'index.js', 'index.css'];

// 功能模块清单：一个功能 = 一个 JS 文件
const MODULES = ['camlog', 'wall-layer', 'annotations-poster', 'camera-constraint', 'pano-layer'];
const MODULE_VERSION = '66'; // 模块缓存破坏符（改模块内容后 +1，避免浏览器缓存旧文件）

// ---------- index.html 补丁 ----------
const HTML_PATCHES = [
    {
        name: 'index.html-注入早期参数解析脚本（默认翻转；?flip=0 关闭；?rot=x,y,z 自定义）',
        target: '<link rel="stylesheet" href="./index.css">',
        replacement: [
            '<script>',
            '            // [本补丁] 官方脚本执行前解析 URL 参数。默认 flip=true（Z-up → Y-up），',
            '            // flip=0 恢复官方朝向，rot=x,y,z 为自定义欧拉角（优先级最高）。',
            '            (function () {',
            '                const u = new URL(location.href);',
            '                window.__ssplatFlip = u.searchParams.get(\'flip\') !== \'0\';',
            '                window.__ssplatRot = u.searchParams.get(\'rot\') || \'\';',
            '                window.__ssplatColdbg = u.searchParams.has(\'coldbg\');',
            '            })();',
            '        </script>',
            '        <link rel="stylesheet" href="./index.css">'
        ].join('\n')
    },
    {
        name: 'index.html-页面标题改为「高斯查看器」',
        target: '<title>SuperSplat Viewer</title>',
        replacement: '<title>高斯查看器</title>'
    },
    {
        name: 'index.html-品牌区文案改为「高斯查看器」',
        target: '<span class="title-name">SuperSplat Viewer</span>',
        replacement: '<span class="title-name">高斯查看器</span>'
    },
    {
        name: 'index.html-移除顶部注解导航条（Annotation Navigator）',
        target: '            <div id="annotationNav" class="hidden">',
        replacement: '            <div id="annotationNav" class="hidden" style="display:none !important">'
    },
    {
        name: 'index.html-annotationInfo 信息块也强制隐藏',
        target: '                <div id="annotationInfo">',
        replacement: '                <div id="annotationInfo" style="display:none !important">'
    },
    {
        name: 'index.html-注入空 favicon（消除 favicon.ico 404）',
        target: '<link rel="stylesheet" href="./index.css">',
        replacement: '<link rel="icon" href="data:,">\n        <link rel="stylesheet" href="./index.css">'
    },
    {
        name: 'index.html-默认 contentUrl 指向 data/wd.compressed.ply',
        target: "const contentUrl = url.searchParams.has('content') ? url.searchParams.get('content') : './scene.compressed.ply';",
        replacement: "const contentUrl = url.searchParams.has('content') ? url.searchParams.get('content') : './data/wd.compressed.ply'; // [本补丁] 默认加载 data 下的 ply"
    },
    {
        name: 'index.html-默认 collisionUrl 指向 data/1.collision.glb（1.obj 空气墙碰撞体；?collision= 可覆盖）',
        target: "const collisionUrl = url.searchParams.get('collision') ?? url.searchParams.get('voxel');",
        replacement: "const collisionUrl = url.searchParams.get('collision') ?? url.searchParams.get('voxel') ?? './data/1.collision.glb'; // [本补丁] 默认空气墙碰撞（1.obj 生成）"
    },
    {
        name: 'index.html-注入加载封面页（cover.jpg 封面 + 莲花/光环/进度/佛光颗粒 来自 Loading page design）',
        target: '</body>',
        replacement: `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;500;600;700&family=Cormorant+Garamond:wght@400;500&display=swap">
<style id="g-loading-style">
html,body{margin:0;padding:0;width:100%;height:100%}
#g-loading{position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;background:#060402;overflow:hidden;font-family:'Noto Serif SC','Songti SC','Microsoft YaHei',serif;font-weight:300;color:#f6e3c0;transition:opacity .7s ease}
#g-loading.g-hidden{opacity:0;pointer-events:none}
.g-bg{position:absolute;left:0;top:0;right:0;bottom:0}
.g-bg::before{content:"";position:absolute;left:0;top:0;right:0;bottom:0;background:url("./img/cover.jpg") center/cover no-repeat;filter:blur(30px) brightness(.5);transform:scale(1.15)}
.g-bg>img{position:absolute;left:50%;top:50%;width:100%;height:100%;object-fit:contain;object-position:center;display:block;transform:translate(-50%,-50%);animation:g-ken 36s ease-in-out infinite alternate}
@keyframes g-ken{from{transform:translate(-50%,-50%) scale(1)}to{transform:translate(-50%,-50%) scale(1.06)}}
.g-bg-dark{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 42%, rgba(6,4,2,0.10) 0%, rgba(6,4,2,0.32) 55%, rgba(4,2,1,0.66) 100%)}
.g-bg-glow{position:absolute;inset:0;mix-blend-mode:soft-light;opacity:.6;background:radial-gradient(70% 55% at 50% 40%, rgba(255,196,110,0.45), transparent 70%)}
.g-motes{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.g-mote{position:absolute;bottom:-8vh}
.g-mote>span{display:block;border-radius:50%}
@keyframes mote-rise{0%{transform:translateY(0) translateX(0);opacity:0}12%{opacity:1}50%{transform:translateY(-58vh) translateX(var(--drift,30px))}88%{opacity:1}100%{transform:translateY(-118vh) translateX(0);opacity:0}}
@keyframes twinkle{0%,100%{opacity:var(--tmin,0.35);transform:scale(0.85)}50%{opacity:var(--tmax,0.9);transform:scale(1)}}
.g-main{position:relative;z-index:10;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 24px}
.g-lotuswrap{position:relative;display:flex;align-items:center;justify-content:center;width:min(70vw,380px);height:min(70vw,380px)}
.g-aura{position:absolute;inset:-8%;background:radial-gradient(circle, rgba(255,205,125,0.4) 0%, rgba(255,180,90,0.1) 42%, transparent 68%);animation:lotus-glow 6s ease-in-out infinite}
.g-halo{position:absolute;width:64%;opacity:.8;animation:lotus-glow 7s ease-in-out infinite}
.g-lotus{position:relative;width:86%;filter:drop-shadow(0 0 46px rgba(255,190,90,0.5));animation:lotus-float 6.5s ease-in-out infinite}
@keyframes lotus-float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-14px) scale(1.015)}}
@keyframes lotus-glow{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.9;transform:scale(1.08)}}
.g-title{text-align:center;margin-top:-8px;animation:text-fade-in 1.2s ease-out both}
.g-eyebrow{font-size:12px;text-transform:uppercase;color:rgba(231,184,119,0.8);letter-spacing:.5em;font-family:'Cormorant Garamond',serif;margin:0}
.g-h1{margin:12px 0 0;font-size:30px;letter-spacing:.35em;color:#fbe6c2;font-weight:500}
@media(min-width:640px){.g-h1{font-size:36px}}
.g-prog{margin-top:40px;width:min(86vw,420px);animation:text-fade-in 1.2s ease-out .2s both}
.g-prog-head{margin-bottom:10px;display:flex;align-items:baseline;justify-content:space-between;color:#e7c896}
.g-stage{font-size:14px;letter-spacing:.25em}
.g-pct{font-size:16px;font-weight:500;color:#fbe6c2;font-family:'Cormorant Garamond',serif;font-variant-numeric:tabular-nums}
.g-track{position:relative;height:4px;border-radius:999px;background:rgba(231,200,150,0.12);box-shadow:inset 0 0 0 1px rgba(231,200,150,0.15)}
.g-bloom{position:absolute;top:-6px;bottom:-6px;left:0;width:0;border-radius:999px;background:linear-gradient(90deg, transparent, rgba(255,196,110,0.35));filter:blur(9px)}
.g-fill{position:absolute;top:0;left:0;height:100%;width:0;border-radius:999px;overflow:hidden;background:linear-gradient(90deg, rgba(255,196,110,0.5), #ffcf7d 60%, #fff2cf);box-shadow:0 0 12px rgba(255,207,125,0.9),0 0 26px rgba(255,180,90,0.55),inset 0 0 6px rgba(255,255,255,0.6)}
.g-shimmer{position:absolute;top:0;bottom:0;left:0;width:33%;background:linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent);animation:bar-shimmer 1.8s ease-in-out infinite}
.g-dot{position:absolute;top:50%;left:0;width:8px;height:8px;transform:translateY(-50%);border-radius:50%;background:#fff4d6;box-shadow:0 0 12px 3px rgba(255,207,125,0.9)}
@keyframes bar-shimmer{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
@keyframes text-fade-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.g-corners{position:absolute;inset:20px;border:1px solid rgba(231,200,150,0.1);pointer-events:none}
</style>
<div id="g-loading">
  <div class="g-bg">
    <img src="./img/cover.jpg" alt="eine">
    <div class="g-bg-dark"></div>
    <div class="g-bg-glow"></div>
  </div>
  <div class="g-motes"></div>
  <div class="g-main">
    <div class="g-lotuswrap">
      <div class="g-aura"></div>
      <img class="g-halo" src="./img/halo.png" alt="">
      <img class="g-lotus" src="./img/lotus.png" alt="金色莲花">
    </div>
    <div class="g-title">
      <p class="g-eyebrow">Immersive Heritage Gallery</p>
      <h1 class="g-h1">云冈石窟 · 数字展</h1>
    </div>
    <div class="g-prog">
      <div class="g-prog-head"><span class="g-stage">构建三维场景</span><span class="g-pct">0%</span></div>
      <div class="g-track">
        <div class="g-bloom"></div>
        <div class="g-fill"><span class="g-shimmer"></span></div>
        <span class="g-dot"></span>
      </div>
      <p class="g-hint" style="margin:16px 0 0;font-size:12px;letter-spacing:.3em;color:rgba(231,200,150,0.55);text-align:center">正在渲染沉浸式三维场景，请稍候</p>
    </div>
  </div>
  <div class="g-corners"></div>
</div>
<script>
(function () {
  var L = document.getElementById('g-loading'); if (!L) return;
  // 真实下载进度：包裹 fetch，监听 .ply 主文件的字节进度（与浏览器的实际加载一致）
  (function () {
    if (window.__plyTrack) return;
    var _f = window.fetch; if (typeof _f !== 'function') return;
    window.__plyTrack = { got: 0, total: 0 };
    window.fetch = function () {
      var input = arguments[0];
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      var pr = _f.apply(this, arguments);
      if (u.indexOf('/data/') >= 0 && u.indexOf('.ply') >= 0) {
        pr.then(function (res) {
          if (!res || !res.ok || !res.body) return;
          var total = +(res.headers.get('Content-Length') || 0);
          // 追踪克隆体，绝不动原始流（避免抢占查看器的读取，导致场景无法加载）
          var clone = res.clone();
          if (!clone || !clone.body) return;
          var reader = clone.body.getReader(); var got = 0;
          var pump = function () {
            return reader.read().then(function (d) {
              if (d.done) { window.__plyTrack.got = total || got; return; }
              if (d.value) got += d.value.byteLength;
              window.__plyTrack = { got: got, total: total };
              return pump();
            }).catch(function () {});
          };
          pump();
        }).catch(function () {});
      }
      return pr;
    };
  })();
  var STAGES = ['正在唤醒石窟造像', '构建三维场景', '加载高精度纹理', '点亮千年佛光', '即将步入展厅'];
  var box = L.querySelector('.g-motes');
  var frag = document.createDocumentFragment();
  for (var i = 0; i < 44; i++) {
    var sparkle = Math.random() < 0.3;
    var size = sparkle ? 1.5 + Math.random() * 2.5 : 10 + Math.random() * 46;
    var depth = sparkle ? 0 : size / 56;
    var wr = document.createElement('span'); wr.className = 'g-mote';
    wr.style.left = Math.random() * 100 + '%';
    wr.style.setProperty('--drift', ((Math.random() - 0.5) * 90).toFixed(1) + 'px');
    wr.style.animation = 'mote-rise ' + (16 + Math.random() * 20).toFixed(1) + 's cubic-bezier(0.4,0,0.5,1) ' + (-Math.random() * 34).toFixed(1) + 's infinite';
    var b = document.createElement('span');
    b.style.width = size.toFixed(1) + 'px'; b.style.height = size.toFixed(1) + 'px';
    b.style.background = sparkle ? 'radial-gradient(circle, #fff6da 0%, rgba(255,214,140,0.9) 40%, rgba(255,180,80,0) 75%)' : 'radial-gradient(circle at 40% 35%, rgba(255,240,205,0.55), rgba(255,196,110,0.28) 42%, rgba(255,160,60,0) 72%)';
    b.style.filter = 'blur(' + (sparkle ? 0.4 : (2 + depth * 14)).toFixed(1) + 'px)';
    b.style.boxShadow = sparkle ? '0 0 6px 1px rgba(255,220,150,0.9)' : 'none';
    b.style.setProperty('--tmin', sparkle ? '0.15' : '0.12');
    b.style.setProperty('--tmax', sparkle ? '0.95' : (0.5 - depth * 0.32).toFixed(3));
    b.style.animation = 'twinkle ' + (3 + Math.random() * 5).toFixed(1) + 's ease-in-out ' + (-Math.random() * 34).toFixed(1) + 's infinite';
    wr.appendChild(b); frag.appendChild(wr);
  }
  box.appendChild(frag);
  var fill = L.querySelector('.g-fill'), bloom = L.querySelector('.g-bloom'), dot = L.querySelector('.g-dot');
  var pctEl = L.querySelector('.g-pct'), stEl = L.querySelector('.g-stage');
  function apply(p) {
    fill.style.width = p + '%'; bloom.style.width = p + '%';
    dot.style.left = 'calc(' + p + '% - 4px)';
    pctEl.textContent = Math.round(p) + '%';
    stEl.textContent = STAGES[Math.min(STAGES.length - 1, Math.floor(p / 100 * STAGES.length))];
  }
  var ended = false, lastW = -1;
  function loop(ts) {
    if (ended) return;
    var want;
    var tr = window.__plyTrack;
    if (tr && tr.total > 0) {
      // 真实下载字节进度 → 映射到 0~85%（余量给上传/初始化）
      var f = Math.min(1, tr.got / tr.total);
      want = f * 85;
    } else {
      // 兜底动画（未探测到主文件时缓慢推进，避免进度条死寂）
      var e = ((ts || 0) % 3400) / 3400;
      var fp = Math.min(1, e / 0.88);
      want = (1 - Math.pow(1 - fp, 2.2)) * 55;
    }
    if (lastW < 0) lastW = want;
    else lastW += (want - lastW) * 0.25; // 平滑过渡
    apply(lastW);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  var iv = setInterval(function () {
    if (window.__ssplatCameraEntity) {
      clearInterval(iv); ended = true;
      var p = lastW < 0 ? 55 : lastW;
      var fin = setInterval(function () {
        p += Math.max(1, (100 - p) * 0.25); apply(p);
        if (p >= 100) { clearInterval(fin); setTimeout(function () { L.classList.add('g-hidden'); setTimeout(function () { L.remove(); }, 800); }, 250); }
      }, 90);
    }
  }, 250);
})();
</script>
</body>`
    }
];

// ---------- index.js 补丁 ----------
const JS_PATCHES = [
    {
        name: 'index.js-坐标系旋转（默认 Z-up → Y-up (-90,0,0)；?flip=0 → 官方 (0,0,180)；?rot= 优先）',
        target: 'entity.setLocalEulerAngles(0, 0, 180);',
        replacement: [
            '{',
            '                const __rot = String(window.__ssplatRot || \'\').split(\',\').map(Number);',
            '                const __custom = __rot.length === 3 && __rot.every(n => Number.isFinite(n));',
            '                const __flip = window.__ssplatFlip !== false;',
            '                entity.setLocalEulerAngles(',
            '                    __custom ? __rot[0] : (__flip ? -90 : 0),',
            '                    __custom ? __rot[1] : 0,',
            '                    __custom ? __rot[2] : (__flip ? 0 : 180)',
            '                );',
            '            }'
        ].join('\n')
    },
    {
        name: 'index.js-暴露相机管理器 / app / 相机实体（功能模块每帧同步相机用）',
        target: '            this.debugPanel = new DebugPanel(global, this.cameraManager);',
        replacement: [
            '            this.debugPanel = new DebugPanel(global, this.cameraManager);',
            '            // [叠加补丁] 暴露相机管理器 / app / 相机实体，供功能模块每帧读取相机位姿/FOV',
            '            window.__ssplatCameraManager = this.cameraManager;',
            '            window.__ssplatApp = typeof app !== "undefined" ? app : null;',
            '            window.__ssplatCameraEntity = global.camera || null;',
            '            // [本补丁] 暴露引擎场景类构造器，供功能模块（pano-layer 全景球）创建网格/材质/实体',
            '            window.__ssplatPano = { Mesh, MeshInstance, StandardMaterial, SphereGeometry, Entity, Color, Texture, CULLFACE_NONE, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, PIXELFORMAT_RGBA8 };'
        ].join('\n')
    },
    {
        name: 'index.js-删除默认自动旋转/巡游动画（静态展示；?anim=1 恢复官方自动转圈）',
        target: [
            '            else if (isObjectExperience) {',
            '                // create basic rotation animation if no anim track is specified',
            '                initial.calcFocusPoint(tmpv);',
            '                return createRotateTrack(initial.position, tmpv, initial.fov);',
            '            }',
            '            // non-object experience: gentle figure-8 motion from inside the scene',
            '            initial.calcFocusPoint(tmpv);',
            '            return createFigure8Track(initial.position, tmpv, initial.fov);'
        ].join('\n'),
        replacement: [
            '            // [本补丁] 默认不生成自动旋转/巡游动画：加载后静态展示，等待手动交互。',
            '            //         官方会对包围盒外的场景自动生成绕圈/8字相机轨道并播放（观感=自动转圈），',
            '            //         这里改为返回 null（等价官方静态场景）。想恢复官方自动转圈，URL 加 ?anim=1。',
            '            if (new URL(location.href).searchParams.get(\'anim\') === \'1\') {',
            '                if (isObjectExperience) {',
            '                    // create basic rotation animation if no anim track is specified',
            '                    initial.calcFocusPoint(tmpv);',
            '                    return createRotateTrack(initial.position, tmpv, initial.fov);',
            '                }',
            '                // non-object experience: gentle figure-8 motion from inside the scene',
            '                initial.calcFocusPoint(tmpv);',
            '                return createFigure8Track(initial.position, tmpv, initial.fov);',
            '            }',
            '            return null;'
        ].join('\n')
    },
    {
        name: 'index.js-默认开启空气墙碰撞（上下左右不穿模）：相机挂 1.obj 碰撞体；?free=1 临时自由飞行',
        target: '            const collision = results[2];',
        replacement: [
            '            // [空气墙碰撞补丁] 默认开启碰撞：相机挂 1.obj 碰撞体（上下左右不穿模）；',
            '            //              ?free=1 临时自由飞行；碰撞体数据(1.collision.glb)常加载，',
            '            //              供注解遮挡点击判定（__ssplatCollision）。',
            '            const __freeFly = new URL(location.href).searchParams.get(\'free\') === \'1\';',
            '            window.__ssplatFreeFly = __freeFly;',
            '            const __collisionData = results[2];',
            '            const collision = __freeFly ? null : __collisionData;'
        ].join('\n')
    },
    {
        name: 'index.js-?coldbg=1 自动开碰撞高亮 + 暴露碰撞体 __ssplatCollision（遮挡点击判定用）',
        target: '            this.cameraManager = new CameraManager(global, sceneBound, collision);',
        replacement: [
            '            // [本补丁] ?coldbg=1 → 自动打开碰撞高亮 overlay（mesh/voxel 线框），核对碰撞体与画面是否对齐',
            '            if (window.__ssplatColdbg && collision) {',
            '                state.collisionOverlayEnabled = true;',
            '                events.fire(\'collisionOverlayEnabled:changed\', true);',
            '            }',
            '            // [校准补丁] 暴露碰撞体实例（自由飞行也加载的数据），供注解遮挡点击判定（queryRay）',
            '            window.__ssplatCollision = __collisionData || null;',
            '            this.cameraManager = new CameraManager(global, sceneBound, collision);'
        ].join('\n')
    },
    {
        name: 'index.js-默认相机模式：空气墙碰撞 fly（上下左右不穿模）；?free=1 自由飞行；?mode= 可强制',
        target: "        state.cameraMode = state.hasAnimation ? 'anim' : (isObjectExperience ? 'orbit' : (walkAllowed ? 'walk' : 'fly'));",
        replacement: [
            '        // [本补丁] 默认相机模式：空气墙碰撞 fly（上下左右不穿模）；',
            '        //          ?free=1 → 临时自由飞行；URL ?mode=orbit|fly|walk 可强制指定。',
            '        const __modeOverride = new URL(location.href).searchParams.get(\'mode\');',
            '        const __freeFly = new URL(location.href).searchParams.get(\'free\') === \'1\';',
            '        state.cameraMode = __modeOverride ? __modeOverride : (state.hasAnimation ? \'anim\' : (__freeFly ? \'fly\' : (collision ? \'fly\' : (isObjectExperience ? \'orbit\' : \'fly\'))));',
            '        // [本补丁] 暴露相机模式，供 camera-constraint 模块按模式执行高度/俯仰约束',
            '        window.__ssplatMode = state.cameraMode;',
            '        if (typeof events.on === \'function\') events.on(\'cameraMode:changed\', (m) => { window.__ssplatMode = m; });'
        ].join('\n')
    },
    {
        name: 'index.js-标注渲染层级下降 + 深度检查：overlay 穿透层 depthTest:false（被遮挡强制最前）→ 改为正常深度测试',
        target: [
            '            Annotation._createHotspotMaterial(this.texture, {',
            '                opacity: 0.25,',
            '                depthTest: false,',
            '                depthWrite: false',
            '            })'
        ].join('\n'),
        replacement: [
            '            // [本补丁] 标注渲染层级下降 + 深度检查：',
            '            //          官方 overlay 穿透层 depthTest:false → 被遮挡仍强制显示在最前；',
            '            //          现改为正常深度测试：被高斯/墙体遮挡时标注被正确遮挡（层级随场景）。',
            '            Annotation._createHotspotMaterial(this.texture, {',
            '                opacity: 0.25,',
            '                depthTest: true,',
            '                depthWrite: false',
            '            })'
        ].join('\n')
    },
    {
        name: 'index.js-标注常显：hidden 仅保留 Show Annotations 手动开关（飞行/指针捕获不再隐藏）',
        target: '            const hidden = !state.showAnnotations || state.controlsHidden || firstPersonGamingControls;',
        replacement: [
            '            // [本补丁] 标注常显：官方在 fly/walk + 玩家操控的指针捕获模式下会把',
            '            //          controlsHidden 强制置 true（isPointerCapturedMode → hideUI），导致注解被隐藏；',
            '            //          这里仅保留用户手动开关 Show Annotations，其余条件一律常显。',
            '            const hidden = !state.showAnnotations;'
        ].join('\n')
    },
    {
        name: 'index.js-注解点击触发：activate 源头拦截本轮移除（图标常显常点）',
        target: [
            '            script.annotation.on(\'show\', () => {',
            '                global.events.fire(\'annotation.activate\', ann);',
            '            });'
        ].join('\n'),
        replacement: [
            '            script.annotation.on(\'show\', () => {',
            '                global.events.fire(\'annotation.activate\', ann);',
            '            });'
        ].join('\n')
    },
    {
        name: 'index.js-注解点击防御：annotation.camera 未配置时不解构崩溃、也不跳相机（浮云框大图交互）',
        target: [
            '        events.on(\'annotation.activate\', (annotation) => {',
            '            events.fire(\'orbitTarget:clear\');',
            '            // switch to orbit camera on pick',
            '            state.cameraMode = \'orbit\';',
            '            const { initial } = annotation.camera;',
            '            // construct camera',
            '            tmpCamera.fov = initial.fov;',
            '            tmpCamera.look(new Vec3(initial.position), new Vec3(initial.target));',
            '            controllers.orbit.goto(tmpCamera);',
            '            startTransition();',
            '        });'
        ].join('\n'),
        replacement: [
            '        events.on(\'annotation.activate\', (annotation) => {',
            '            events.fire(\'orbitTarget:clear\');',
            '            // [本补丁] 注解未配置预设相机(camera)时不跳位、不崩溃：',
            '            //          浮云框大图交互（annotations-poster.js）点注解即触发 activate，',
            '            //          但注解没有 camera.initial（settings 未配置），官方会解构报错；',
            '            //          这里改为可选链，无预设机位则直接跳过（保持当前相机模式）。',
            '            const initial = annotation.camera?.initial;',
            '            if (!initial) {',
            '                return;',
            '            }',
            '            // switch to orbit camera on pick',
            '            state.cameraMode = \'orbit\';',
            '            // construct camera',
            '            tmpCamera.fov = initial.fov;',
            '            tmpCamera.look(new Vec3(initial.position), new Vec3(initial.target));',
            '            controllers.orbit.goto(tmpCamera);',
            '            startTransition();',
            '        });'
        ].join('\n')
    },
    {
        name: 'index.js-标注图片标记（全量）：img/热点标记.png，2号用热点标记1.png，选中切激活图，常显常点',
        target: [
            '        // Create texture',
            '        this.texture = Annotation._createHotspotTexture(this.app, this.label);'
        ].join('\n'),
        replacement: [
            '        // Create texture',
            '        this.texture = Annotation._createHotspotTexture(this.app, this.label);',
            '        // [本补丁] 所有标注统一使用 img/热点标记-激活.png（1.62x，无呼吸，用户指定试用此图）：',
            '        //          选中/取消切换保持同一张图（后续如需区分再改回 base/激活 双图）。',
            '        //          异步加载，失败回退官方圆点。像素大小按光效实际像素等比换算与官方标记一致。',
            '        this._markerKey = this.label;',
            '        this._markerActive = false;',
            '        this._markerBoost = 1.62;',
            '        this._markerTex = { base: null, active: null };',
            '        if (this._markerKey) {',
            '            const dv = this.app.graphicsDevice;',
            '            // [修复] alpha 透明通道：createImageBitmap+setSource 在 WebGPU 下 alpha 未正确上传 → 透明区显示黑。',
            '        //       改用官方已验证的渲染路径：Image→canvas(2次幂)→getImageData(逐像素RGBA)→levels 上传；',
            '        //       注意：不再“白化半透像素”（官方数字圆点才需要），发光图保留原RGB，金色渐变+alpha 原样上屏。',
            '            const mkTex = (url) => new Promise((res) => {',
            '                const im = new Image();',
            '                im.onload = () => {',
            '                    try {',
            '                        const size = 128;',
            '                        const cv = document.createElement(\'canvas\'); cv.width = size; cv.height = size;',
            '                        const g = cv.getContext(\'2d\');',
            '                        const s = Math.min(size / im.naturalWidth, size / im.naturalHeight);',
            '                        const dw = im.naturalWidth * s, dh = im.naturalHeight * s;',
            '                        g.drawImage(im, (size - dw) / 2, (size - dh) / 2, dw, dh);',
            '                        const id = g.getImageData(0, 0, size, size);',
            '                        const d = id.data;',
            '                        // [修复] 强制二元透明通道（用户要求，无渐变）：alpha<16 全透明(0)，其余拉满(255)；',
'                        //       不透明像素保留原 RGB（金色）；透明像素 RGB 强制归零——即便混合通道失效，',
'                        //       也配合材质 alphaTest 直接 discard，透明区绝不呈黑/白方块。',
'                        for (let i = 0; i < d.length; i += 4) {',
'                            const a = d[i + 3] < 16 ? 0 : 255;',
'                            d[i + 3] = a;',
'                            if (a === 0) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; }',
'                        }',
            '                        const t = new Texture(dv, { width: size, height: size, format: PIXELFORMAT_RGBA8, mipmaps: false, magFilter: FILTER_LINEAR, minFilter: FILTER_LINEAR, levels: [new Uint8Array(d.buffer)] });',
            '                        res(t);',
            '                    } catch (e) { console.warn(\'[marker] 纹理生成失败：\', url, e); res(null); }',
            '                };',
            '                im.onerror = () => { console.warn(\'[marker] 图片加载失败：\', url); res(null); };',
            '                im.src = url;',
            '            });',
            '            const baseUrl = \'./img/热点标记-激活.png\';',
            '            Promise.all([mkTex(baseUrl), mkTex(\'./img/热点标记-激活.png\')]).then((ts) => {',
            '                if (!this.materials || !this.materials.length || !ts[0]) return;',
            '                this._markerTex.base = ts[0];',
            '                this._markerTex.active = ts[1] || ts[0];',
            '                this._applyMarkerTex(this._markerActive ? this._markerTex.active : this._markerTex.base);',
            '            });',
            '        }',
            '        this._applyMarkerTex = (tex) => {',
'            if (!tex || !this.materials) return;',
'            this.materials.forEach((m) => {',
'                m.emissiveMap = tex;',
'                m.opacityMap = tex;',
'                // [修复] 强制开启透明通道（用户要求）：显式 straight-alpha 混合',
'                //   blendType=2(BLEND_NORMAL: src.a / 1-src.a)——纹理数据为非预乘 RGBA；',
'                //   alphaTest=0.5 兜底：alpha<128 的像素直接 discard，即使 WebGPU 下混合',
'                //   未生效或半透边缘混色，透明区（RGB=0）与渐变边缘也绝不上屏，只显示金色本体。',
'                //   opacity=0.5：标注图标整体 50% 半透明（用户要求）。',
'                m.blendType = 2;',
'                m.alphaTest = 0.5;',
'                m.opacity = 0.5;',
'                m.update();',
'            });',
'            if (this.app) this.app.renderNextFrame = true;',
'        };',
            '        this._setMarkerActive = (active) => {',
            '            if (!this._markerKey) return;',
            '            this._markerActive = !!active;',
            '            this._markerBoost = 1.62;',
            '            const t = this._markerTex[this._markerActive ? \'active\' : \'base\'];',
            '            if (t) this._applyMarkerTex(t);',
            '        };'
        ].join('\n')
    },
    {
        name: 'index.js-标注恒定大小（无呼吸）：等比放大至与官方标记一致的像素尺寸',
        target: [
            '        const scale = this._calculateScreenSpaceScale(viewDepth);',
            '        this.entity.setLocalScale(scale, scale, scale);'
        ].join('\n'),
        replacement: [
            '        // [本补丁] 标注恒定大小：等比放大至与官方圆点一致的像素尺寸（无呼吸动画）。',
            '        let scale = this._calculateScreenSpaceScale(viewDepth);',
            '        if (this._markerKey) scale = scale * this._markerBoost;',
            '        this.entity.setLocalScale(scale, scale, scale);'
        ].join('\n')
    },
    {
        name: 'index.js-标注1/2选中/取消事件：activate 切换激活图，deactivate 恢复，并暴露 __ssplatMarker 供浮窗关闭时恢复',
        target: [
            '        // handle navigator requesting an annotation to be shown',
            '        global.events.on(\'annotation.navigate\', (ann) => {',
            '            const script = scriptMap.get(ann);'
        ].join('\n'),
        replacement: [
            '        // [本补丁] 标注1/2 选中状态切换：annotation.activate → 对应标注换“热点标记-激活.png”，',
            '        //          annotation.deactivate / 浮窗关闭 → 全部恢复原图且恢复呼吸。',
            '        global.events.on(\'annotation.activate\', (ann2) => {',
            '            const script = scriptMap.get(ann2);',
            '            if (script && script.annotation && typeof script.annotation._setMarkerActive === \'function\') {',
            '                script.annotation._setMarkerActive(true);',
            '            }',
            '        });',
            '        const clearMarkers = () => {',
            '            let changed = false;',
            '            for (const s of scriptMap.values()) {',
            '                if (s.annotation && s.annotation._markerActive) { s.annotation._setMarkerActive(false); changed = true; }',
            '            }',
            '            if (changed) global.app.renderNextFrame = true;',
            '        };',
            '        global.events.on(\'annotation.deactivate\', clearMarkers);',
            '        window.__ssplatMarker = { deactivate: clearMarkers };',
            '        // handle navigator requesting an annotation to be shown',
            '        global.events.on(\'annotation.navigate\', (ann) => {',
            '            const script = scriptMap.get(ann);'
        ].join('\n')
    },
        {
        name: 'index.js-标注 DOM 样式补强：热区/说明气泡显式透明 + 层级（标签透明兜底）',
        target: '        Annotation.styleSheet = style;\n    }',
        replacement: [
            '        Annotation.styleSheet = style;',
            '        // [本补丁] 标注标签透明补强（困挠已久的黑/白方块问题最后兜底层）：',
            '        //   1) 点击热区(.pc-annotation-hotspot)：显式 background: transparent !important，',
            '        //      阻断任何父级/内联默认底色，30px 热区纯透明只做点击；',
            '        //   2) 说明气泡(.pc-annotation)：官方 rgba(0,0,0,0.8) 在浅背景下呈黑块，',
            '        //      降为 rgba(0,0,0,0.35) 半透明深底，文字白字+阴影保持可读；',
            '        //   3) 层级/交互：气泡 z-index 高于热区但 pointer-events:none 不挡点击，',
            '        //      热区 pointer-events:auto 保持可点。',
            '        const _annExtraStyle = document.createElement(\'style\');',
            '        _annExtraStyle.textContent = [',
            '            \'.pc-annotation-hotspot { background: transparent !important; pointer-events: auto !important; }\',',
            '            \'.pc-annotation { background: rgba(0, 0, 0, 0.35) !important; border: none !important; box-shadow: none !important; }\',',
            '            \'.pc-annotation-title, .pc-annotation-text { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }\'',
            '        ].join(\'\\n\\n\');',
            '        document.head.appendChild(_annExtraStyle);',
            '    }'
        ].join('\n')
    },
    {
        name: 'index.js-吞掉 requestPointerLock 的 promise reject（PointerLockManager.canvas 路径）',
        target: '            this._canvas?.requestPointerLock();',
        replacement: [
            '            // [本补丁] requestPointerLock 在"刚退出锁定立即重进"时会 reject（浏览器冷却限制），',
            '            //          吞掉 reject 避免 Uncaught (in promise)；状态机由 pointerlockerror/change 事件兜底',
            '            this._canvas?.requestPointerLock()?.catch(() => {});'
        ].join('\n')
    },
    {
        name: 'index.js-吞掉 FlySource/WalkSource 的 requestPointerLock promise reject（鼠标输入路径）',
        target: 'this._element?.requestPointerLock();',
        replacement: [
            '                               // [本补丁] 同上：退出锁定后立即重进会 reject，吞掉即可',
            '                               this._element?.requestPointerLock()?.catch(() => {});'
        ].join('\n')
    },
    {
        name: 'index.js-游戏控制强制直接打开（用户要求，苹果端/移动端落地即用）',
        target: '        gamingControls: localStorage.getItem(\'gamingControls\') === \'true\'',
        replacement: [
            '        // [本补丁] 游戏控制强制直接打开（用户要求）：无条件 gamingControls=true，',
            '        //          苹果端/移动端进入即显示 move.png 方向摇杆，不再依赖设备/存储判断；',
            '        //          仍可用 G 键或设置面板手动关闭。',
            '        gamingControls: true'
        ].join('\n')
    }
];

/** 严格替换：目标必须恰好出现 1 次，否则报错（官方升级导致文案变化时能立即发现）。 */
const applyStrictPatch = (content, { name, target, replacement }) => {
    const count = content.split(target).length - 1;
    if (count !== 1) {
        throw new Error(`补丁「${name}」失败：目标片段出现 ${count} 次（期望 1 次）。官方文件可能已变动，请检查 target。`);
    }
    return content.replace(target, replacement);
};

const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const main = async () => {
    await mkdir(DIST_DIR, { recursive: true });
    console.log('=== 开始构建 ===');

    for (const file of VIEWER_FILES) {
        const content = await readFile(join(PKG_PUBLIC, file), 'utf8');
        let output = content;

        if (file === 'index.html') {
            for (const patch of HTML_PATCHES) {
                output = applyStrictPatch(output, patch);
                console.log(`  [补丁] ${patch.name}`);
            }
            const MODULE_SCRIPTS = MODULES
                .map((name) => `    <script type="module" src="./${name}.js?v=${MODULE_VERSION}"></script>`)
                .join('\n');
            if (!/<\/body>/i.test(output)) {
                throw new Error('构建失败：官方 index.html 中未找到 </body>，无法注入模块脚本。');
            }
            // 移动端方向控制：使用官方平台自带默认摇杆（用户要求，不再自定义图标）
            output = output.replace(/<\/body>/i, MODULE_SCRIPTS + '\n</body>');
            console.log(`  [注入] 功能模块脚本 × ${MODULES.length}（${MODULES.map((n) => `${n}.js`).join(' / ')}）`);
        } else if (file === 'index.js') {
            for (const patch of JS_PATCHES) {
                output = applyStrictPatch(output, patch);
                console.log(`  [补丁] ${patch.name}`);
            }
        }

        await writeFile(join(DIST_DIR, file), output, 'utf8');
        console.log(`  [复制] dist/${file}  ${formatSize(Buffer.byteLength(output))}`);
    }

    // settings.json（背景 / 后处理 / 初始相机 / 注解）
    const settings = await readFile(join(ROOT, 'settings.json'), 'utf8');
    await writeFile(join(DIST_DIR, 'settings.json'), settings, 'utf8');
    console.log('  [复制] dist/settings.json');

    // 功能模块（每个功能一个 JS 文件）
    for (const name of MODULES) {
        await writeFile(join(DIST_DIR, `${name}.js`), await readFile(join(SRC_DIR, `${name}.js`), 'utf8'), 'utf8');
        console.log(`  [复制] dist/${name}.js`);
    }

    // 清理被移除/取代的旧入口
    for (const stale of ['custom.js', 'overlay.js', 'points-layer.js', 'label3d.js', 'polygon-layer.js']) {
        const p = join(DIST_DIR, stale);
        if (existsSync(p)) {
            await rm(p);
            console.log(`  [清理] dist/${stale}（已由拆分模块取代）`);
        }
    }

    // three 运行时（ESM，直接在浏览器 import，不打包）：只复制模块需要的两个文件
    // （three.module.js 内部会 import './three.core.js'，两者缺一不可）
    if (existsSync(THREE_BUILD)) {
        await mkdir(VENDOR_DIR, { recursive: true });
        for (const file of ['three.module.js', 'three.core.js']) {
            const src = join(THREE_BUILD, file);
            if (!existsSync(src)) {
                console.log(`  [警告] 未找到 ${file}，wall-layer（three 叠加层）可能无法加载`);
                continue;
            }
            const content = await readFile(src);
            await writeFile(join(VENDOR_DIR, file), content);
            console.log(`  [复制] dist/vendor/${file}  ${formatSize(content.length)}`);
        }
    } else {
        console.log('  [警告] 未找到 node_modules/three/build，wall-layer（three 叠加层）将无法加载（先 npm install three）');
    }

    console.log('');
    console.log('=== 构建完成 ===');
    console.log(`输出目录: ${DIST_DIR}`);
    console.log('启动方式: node scripts/serve.mjs  （默认 http://127.0.0.1:8123/）');
    console.log('朝向: 默认 Z-up → Y-up (-90,0,0)；?flip=0 恢复官方 (0,0,180)；?rot=x,y,z 自定义');
    console.log('相机: 默认空气墙碰撞（上下左右不穿模）；?free=1 临时自由飞行（?mode=orbit|fly|walk、?coldbg=1 辅助）');
    console.log('提示：data/ 目录由服务器直接映射，不复制到 dist（零拷贝）');
};

main().catch((err) => {
    console.error('构建失败：', err);
    process.exit(1);
});