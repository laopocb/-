/* 真实浏览器核验：本地 v36 标记渲染真相（近距离截图 + [marker] 日志） */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
mkdirSync(process.env.TEMP + '/trae-marker', { recursive: true });
try { rmSync(process.env.TEMP + '/trae-marker-prof', { recursive: true, force: true }); } catch (e) {}

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = process.env.TEMP + '/trae-marker';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const url = 'http://localhost:8123/';
  const args = [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--user-data-dir=' + OUT + '-profile',
    '--window-size=1280,800', '--force-device-scale-factor=1', url
  ];
  const child = spawn(EDGE, args, { stdio: 'ignore' });
  let seq = 0; const send = (m) => child.send({ id: ++seq, method: m.method, params: m.params || {} });
  const wait = (m) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout:' + m)), 30000); child.once('message', (d) => { if (d && d.id === seq) { clearTimeout(t); res(d); } }); });

  const respP = new Promise((res) => child.once('message', (d) => d.id === 0 && res(d)));
  const ver = await (async () => { const webSock = new WebSocket('ws://127.0.0.1:9222/devtools/browser'); await new Promise((r, j) => { webSock.onopen = r; webSock.onerror = j; }); const v = await new Promise((r) => { webSock.onmessage = (e) => r(JSON.parse(e.data)); webSock.send(JSON.stringify({ id: 1, method: 'Target.getTargets' })); }); return v; })().catch(() => null);

  console.log('不能复用浏览器WS，改用简单流程：等待并截图');
  // 简化：直接用独立浏览器进程 + 自带页面，通过 --remote-debugging-port 重新起
  child.kill();
  await sleep(500);

  const port = 9333;
  const c2 = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--disable-http-cache',
    `--remote-debugging-port=${port}`, '--user-data-dir=' + process.env.TEMP + '/trae-marker-prof',
    '--window-size=1280,800', url
  ], { stdio: 'ignore' });
  await sleep(2500);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page').id}`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let idn = 0; const pend = new Map(); const consoleLines = []; const ctxList = [];
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.executionContextCreated') {
      ctxList.push({ id: d.params.context.id, name: d.params.context.name, origin: d.params.context.origin });
    }
    if (d.method === 'Runtime.consoleAPICalled') {
      const t = (d.params.args || []).map((a) => a.value !== undefined ? String(a.value) : a.description || '').join(' ');
      consoleLines.push(`[console.${d.params.type}] ${t}`);
    }
  };
  const cdp = (m, p = {}) => new Promise((res) => { const id = ++idn; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
  await cdp('Runtime.enable');
  const ev = async (expr) => {
    const mainCtx = ctxList.find((c) => c.origin && c.origin.startsWith('http')) || ctxList[ctxList.length - 1];
    const p = { expression: expr, returnByValue: true };
    if (mainCtx) p.contextId = mainCtx.id;
    const r = await cdp('Runtime.evaluate', p);
    if (r.exceptionDetails) return { ERR: (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text || '').slice(0, 220) };
    return r.result && r.result.value;
  };
  console.log('EVTEST:', JSON.stringify(await ev('1 + 1')));
  console.log('EVRAW:', JSON.stringify(await cdp('Runtime.evaluate', { expression: '1 + 1', returnByValue: true })));

  // 等加载完成
  for (let i = 0; i < 60; i++) { await sleep(1000); const ok = await ev('!!window.__ssplatCameraEntity && document.querySelector("canvas") && !document.getElementById("g-loading")'); if (ok) break; }
  console.log('markerInfo:', JSON.stringify(await ev('window.__markerInfo ? window.__markerInfo() : null')));
  console.log('PAGEDIAG:', JSON.stringify(await ev(`(function () { try { return JSON.stringify({ mi: typeof window.__markerInfo, app: !!window.__ssplatApp, diag: window.__markerDiag || [] }); } catch (e) { return 'THROW:' + e; } })()`)));
  const diag = await ev(`(() => {
    const app = window.__ssplatApp; if (!app) return 'no-app';
    const s = app.root.findComponents('script')[0];
    const a = s && s.annotation;
    if (!a) return 'no-ann';
    const info = window.__markerInfo ? window.__markerInfo() : null;
    return {
      key: a._markerKey,
      label: a.label,
      rasetsi: JSON.stringify(info),
      baseImg: a._markerTex && a._markerTex.base ? a._markerTex.base.naturalWidth : 0,
      activeImg: a._markerTex && a._markerTex.active ? a._markerTex.active.naturalWidth : 0,
      m0tex: a.materials && a.materials[0] && a.materials[0].emissiveMap ? a.materials[0].emissiveMap.width : 0,
      m1tex: a.materials && a.materials[1] && a.materials[1].emissiveMap ? a.materials[1].emissiveMap.width : 0,
      scriptCount: app.root.findComponents('script').length
    };
  })()`);
  console.log('diag1:', JSON.stringify(diag));
  await sleep(3000);
  const diag2 = await ev(`(() => {
    const app = window.__ssplatApp; if (!app) return 'no-app';
    const ss = app.root.findComponents('script').filter(s => s.annotation);
    if (!ss.length) return 'no-ann';
    const a = ss[0].annotation;
    return {
      markerInfo: window.__markerInfo ? window.__markerInfo() : null,
      key: a._markerKey,
      label: a.label,
      baseImg: a._markerTex && a._markerTex.base ? a._markerTex.base.naturalWidth : 0,
      m0tex: a.materials && a.materials[0] && a.materials[0].emissiveMap ? a.materials[0].emissiveMap.width : 0,
      m1tex: a.materials && a.materials[1] && a.materials[1].emissiveMap ? a.materials[1].emissiveMap.width : 0,
      count: ss.length
    };
  })()`);
  console.log('diag2:', JSON.stringify(diag2));

  // 近距离看 2号
  await ev(`(() => { try { const o = window.__ssplatApp.controllers.orbit; if (o && o.goto) o.goto({ position: { x: 3.4, y: 0.4, z: 26.8 }, target: { x: 3.64, y: 0.94, z: 27.46 } }); return 'ok'; } catch (e) { return 'err:' + e; } })()`);
  await sleep(3500);
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, 'marker_close.png'), Buffer.from(shot.result.data, 'base64'));
  // 采样画面中心区域颜色（5x5 平均，几个位置）
  const px = await ev(`(async () => { const f = await window.captureFrame({ width: 160, height: 100 }); const b = atob(f.data);
    const g = (x,y) => [b.charCodeAt((y*160+x)*4), b.charCodeAt((y*160+x)*4+1), b.charCodeAt((y*160+x)*4+2)];
    const avg = (x,y,r) => { let s=[0,0,0]; for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const c=g(x+dx,y+dy);s[0]+=c[0];s[1]+=c[1];s[2]+=c[2];} const n=(2*r+1)*(2*r+1); return [Math.round(s[0]/n),Math.round(s[1]/n),Math.round(s[2]/n)]; };
    return { center: avg(80,50,3), off: avg(95,50,2), big: avg(110,50,1) }; })()`);
  console.log('centerPx:', JSON.stringify(px));
  console.log('--- console 摘要 ---');
  consoleLines.slice(-30).forEach((l) => console.log(l));
  c2.kill();
  console.log('截图已存: ' + OUT + '\\marker_close.png');
})().catch((e) => { console.error('ERR', e); process.exit(1); });