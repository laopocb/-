/* 三端适配测试：Edge CDP 设备模拟（安卓 / 鸿蒙 / 苹果），截图 + 布局 + 触摸旋转 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9229;
const OUT = join(tmpdir(), 'trae-mobile');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8123/';
const ONLY = process.env.ONLY || '';
mkdirSync(OUT, { recursive: true });

const PROFILES = [
  { name: 'android',  w: 412, h: 915, dpr: 2.625, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' },
  { name: 'harmony',  w: 393, h: 851, dpr: 3, ua: 'Mozilla/5.0 (Linux; Android 10; HarmonyOS; HUAWEI ALN-AL10; HMSCore 6.13.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
  { name: 'ios',      w: 393, h: 852, dpr: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  { name: 'desktop',  w: 1920, h: 1080, dpr: 1, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws = null, msgId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve2, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve2, reject });
  if (ws.readyState === 1) ws.send(JSON.stringify({ id, method, params }));
  else reject(new Error('ws not open'));
});

const methodNames = new Map();
function send2(method, params = {}) { methodNames.set(msgId + 1, method); return send(method, params); }

async function cdp(method, params) {
  return Promise.race([
    send2(method, params),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + method)), 25000))
  ]);
}

async function evaluate(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { err: r.exceptionDetails.text };
  return r.result.value;
}

async function screenshot(file) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'));
  return join(OUT, file);
}
async function touchDrag(x0, y0, dx, dy) {
  const t = Date.now();
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  await sleep(60);
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx, y: y0 + dy, id: 1 }] });
  await sleep(60);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const reports = [];
async function testProfile(p) {
  const tag = `[${p.name}]`;
  const rep = { name: p.name, w: p.w, h: p.h, dpr: p.dpr };
  try {
    const isMobile = p.name !== 'desktop';
    await cdp('Emulation.setDeviceMetricsOverride', { width: p.w, height: p.h, deviceScaleFactor: p.dpr, mobile: isMobile, screenWidth: p.w, screenHeight: p.h });
    if (isMobile) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    else await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp('Network.setUserAgentOverride', { userAgent: p.ua, platform: p.name === 'ios' ? 'iOS' : p.name === 'desktop' ? 'Windows' : 'Linux' });
    await cdp('Page.navigate', { url: BASE_URL });

    // 1) 加载封面截图（等待封面出现）
    await sleep(2500);
    rep.cover = await screenshot(p.name + '_cover.png');

    // 2) 等待场景加载完成（__ssplatCameraEntity 出现）
    let loaded = false;
    for (let i = 0; i < 100; i++) {
      const ok = await evaluate('!!window.__ssplatCameraEntity').catch(() => false);
      if (ok) { loaded = true; break; }
      await sleep(1200);
    }
    rep.loadedInSec = 0; // 加载成功时由实际经过时间回填
    if (!loaded) { rep.fail = '加载超时'; }
    rep.scene = await screenshot(p.name + '_scene.png');

    // 3) 布局 / 平台信息
    rep.info = await evaluate(`(() => ({
      iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio,
      sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      gLoadingGone: !document.getElementById('g-loading'),
      hots: document.querySelectorAll('#annotations .pc-annotation-hotspot').length,
      camY: window.__ssplatCameraEntity ? window.__ssplatCameraEntity.getPosition().y : null,
      m0w: (() => { const a = window.__ssplatApp && window.__ssplatApp.root.findComponents('script').find(s => s.annotation && s.annotation.materials); return a ? a.annotation.materials[0].emissiveMap.width : 0; })(),
      m1w: (() => { const a = window.__ssplatApp && window.__ssplatApp.root.findComponents('script').find(s => s.annotation && s.annotation.materials); return a ? a.annotation.materials[1].emissiveMap.width : 0; })(),
      marker: window.__markerInfo ? window.__markerInfo() : null,
      mode: window.__ssplatMode || null,
      constraint: window.__ssplatCamConstraint === true,
      plyTotal: (window.__plyTrack && window.__plyTrack.total) || 0,
      canvas: (() => { const c = document.getElementById('application-canvas'); return c ? c.getBoundingClientRect().width + 'x' + c.getBoundingClientRect().height : 'none'; })(),
      ui: (() => { const u = document.getElementById('ui'); return u ? u.getBoundingClientRect().toJSON() : null; })(),
      webgpu: !!navigator.gpu,
      webgl2: !!document.createElement('canvas').getContext('webgl2'),
      touch: 'ontouchstart' in window,
    }))()`);

    // 4.5) 移动探针（desktop + MOVETEST=1）：对比 约束开/关 时滚轮推进是否让相机位移
    if (!isMobile && process.env.MOVETEST === '1') {
      const camState = () => evaluate(`(() => { const c = window.__ssplatCameraEntity; if (!c) return null;
        const p = c.getPosition(); const q = c.getRotation();
        const x=q.x, y=q.y, z=q.z, w=q.w;
        const fx = -2*(x*z + y*w), fy = 2*(x*w - y*z), fz = -1 + 2*(x*x + y*y);
        return { x: p.x.toFixed(2), y: p.y.toFixed(2), z: p.z.toFixed(2), fx: fx.toFixed(2), fy: fy.toFixed(2), fz: fz.toFixed(2) };
      })()`).catch(() => null);
      const wheel = async (dy) => {
        await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 960, y: 540, deltaX: 0, deltaY: dy });
        await sleep(700);
      };
      rep.m1 = await camState();
      await wheel(-600 * 3); // 向前（放大/前进）
      rep.m2 = await camState();
      // 无指针锁的鼠标拖拽：能否旋转视角
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 960, y: 540, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 4; i++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 960 - i * 60, y: 540 - i * 15, button: 'left' }); await sleep(120); }
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 480, button: 'left', clickCount: 1 });
      await sleep(800);
      rep.mrot = await camState();
      // 大幅向上拖拽：验证俯仰钳到 ±20° 且 yaw 不被强制拧转
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 960, y: 540, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 6; i++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 960, y: 540 - i * 70, button: 'left' }); await sleep(100); }
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 960, y: 120, button: 'left', clickCount: 1 });
      await sleep(900);
      rep.mclamp = await camState();
      await evaluate('window.__ssplatFreeFly = true'); // 只关相机约束（碰撞体仍在页面里）
      await wheel(-600 * 3);
      rep.m3 = await camState();
      console.log('MOVETEST m1m2mrot mclamp m3:', JSON.stringify({ m1: rep.m1, m2: rep.m2, mrot: rep.mrot, mclamp: rep.mclamp, m3: rep.m3 }));
    }
    // 4.7) 门口视角标记渲染验证（desktop + DOOR=1）：1_点 对准画面中心，采样中心像素颜色
    if (!isMobile && process.env.DOOR === '1') {
      rep.door = await evaluate(`(async () => {
        const e = window.__ssplatCameraEntity; if (!e) return 'no-cam';
        const pos = [11.52, 0.9, 18.5];
        e.setPosition(pos[0], pos[1], pos[2]);
        await new Promise(r => setTimeout(r, 800)); // 等高度约束/移动器稳定
        const ap = e.getPosition();
        const t = [11.52, 0.55, 23.48]; // 1_点
        let dx = t[0]-ap.x, dy = t[1]-ap.y, dz = t[2]-ap.z;
        const dl = Math.hypot(dx,dy,dz); dx/=dl; dy/=dl; dz/=dl;
        const yaw = Math.atan2(-dx, dz), pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
        const s1=Math.sin(yaw/2), c1=Math.cos(yaw/2), s2=Math.sin(pitch/2), c2=Math.cos(pitch/2);
        e.setRotation(c1*s2, c2*s1, -s1*s2, c1*c2);
        await new Promise(r => setTimeout(r, 600));
        const f = await window.captureFrame({ width: 96, height: 96 });
        const bytes = atob(f.data);
        const px = (x, y) => [bytes.charCodeAt((y * 96 + x) * 4), bytes.charCodeAt((y * 96 + x) * 4 + 1), bytes.charCodeAt((y * 96 + x) * 4 + 2), bytes.charCodeAt((y * 96 + x) * 4 + 3)];
        return { ap: [+ap.x.toFixed(2), +ap.y.toFixed(2), +ap.z.toFixed(2)], center: px(48, 48), ring: px(57, 48), ring2: px(66, 48), bg: px(90, 90) };
      })()`).catch((e2) => ({ err: String(e2) }));
      console.log('DOORTEST ' + JSON.stringify(rep.door));
    }
    // 4.8) 标记像素颜色验证（desktop + DIFF=1）：标注开/关差分 → 统计标记像素的平均色/最亮色
    if (!isMobile && process.env.DIFF === '1') {
      rep.diff = await (async () => {
        // 用引擎 orbit.goto 瞬移到门口视角，保证视野里有标记
        const g = await evaluate(`(() => { try { const o = window.__ssplatApp.controllers.orbit; if (o && o.goto) { o.goto({ position: { x: 7.4, y: -0.33, z: 11.5 }, target: { x: 0.97, y: 0.21, z: 19.14 } }); return 'ok'; } return 'no-goto'; } catch (e) { return 'err:' + e; } })()`);
        await sleep(2600);
        return evaluate(`(async () => {
        const app = window.__ssplatApp;
        if (!app) return 'no-app';
        const W=192, H=108;
        const anns = app.root.findComponents('script').filter(s => s.annotation && s.annotation.materials && s.annotation.materials.length);
        if (!anns.length) return 'no-anns';
        const fA = await window.captureFrame({ width: W, height: H });
        for (const s of anns) { s.annotation.materials.forEach(m => { m.emissiveMap = null; m.emissive.set(1, 0, 1); m.update(); }); }
        app.renderNextFrame = true;
        await new Promise(r => setTimeout(r, 350));
        const fB = await window.captureFrame({ width: W, height: H });
        for (const s of anns) s.annotation._markerTex && s.annotation._applyMarkerTex && s.annotation._applyMarkerTex(s.annotation._markerActive ? s.annotation._markerTex.active : s.annotation._markerTex.base);
        app.renderNextFrame = true;
        await new Promise(r => setTimeout(r, 450));
        const fC = await window.captureFrame({ width: W, height: H });
        const dA = atob(fA.data), dB = atob(fB.data), dC = atob(fC.data);
        const pts = [];
        for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
          const i4 = (y * W + x) * 4;
          const md = Math.max(Math.abs(dA.charCodeAt(i4)-dB.charCodeAt(i4)), Math.abs(dA.charCodeAt(i4+1)-dB.charCodeAt(i4+1)), Math.abs(dA.charCodeAt(i4+2)-dB.charCodeAt(i4+2)));
          if (md > 40) pts.push([x, y, i4]);
        }
        if (!pts.length) return { pts: 0 };
        let sr = 0, sg = 0, sb = 0, mr = 0, mg = 0, mb = 0;
        for (const [,,i4] of pts) {
          const r = dC.charCodeAt(i4), g = dC.charCodeAt(i4+1), b = dC.charCodeAt(i4+2);
          sr += r; sg += g; sb += b;
          if (r + g + b > mr + mg + mb) { mr = r; mg = g; mb = b; }
        }
        return {
          pts: pts.length,
          avgRestored: [Math.round(sr/pts.length), Math.round(sg/pts.length), Math.round(sb/pts.length)],
          brightestRestored: [mr, mg, mb]
        };
      })()`).catch((e2) => ({ err: String(e2) }));
      })();
      console.log('DIFFTEST ' + JSON.stringify(rep.diff));
    }
    if (isMobile) {
      const before = await evaluate('window.__ssplatCameraManager && window.__ssplatCameraManager.camera ? JSON.stringify(window.__ssplatCameraManager.camera.getPosition()) : "no"');
      await touchDrag(Math.round(p.w / 2), Math.round(p.h / 2), -140, 70);
      await sleep(1200);
      const after = await evaluate('window.__ssplatCameraManager && window.__ssplatCameraManager.camera ? JSON.stringify(window.__ssplatCameraManager.camera.getPosition()) : "no"');
      rep.dragOK = before !== after;
      rep.camBefore = before; rep.camAfter = after;
      rep.scene2 = await screenshot(p.name + '_after.png');
    }
  } catch (e) {
    rep.err = String(e).slice(0, 300);
  }
  reports.push(rep);
  console.log(tag, JSON.stringify(rep).slice(0, 600));
  return rep;
}

async function main() {
  if (existsSync(OUT)) { try { rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true }); } catch {} }
  const userData = join(tmpdir(), 'trae-mobile-edge-' + Date.now());
  const edge = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userData, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'
  ], { stdio: 'ignore' });

  // 等待调试端口就绪
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch { }
    await sleep(500);
  }
  // 建一个标签页
  let tab;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    tab = await r.json();
  } catch {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`);
    tab = await r.json();
  }
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  // 常驻消息泵：所有 CDP 响应按 id 分发
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error((methodNames.get(m.id) || '?') + ': ' + JSON.stringify(m.error))) : p.resolve2(m.result);
    }
  });

  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');

  for (const p of PROFILES) { if (ONLY && p.name !== ONLY) continue; await testProfile(p); }

  console.log('\n=== 汇总 ===');
  console.log(JSON.stringify(reports, null, 2));
  console.log('截图目录: ' + OUT);
  edge.kill();
  process.exit(0);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });