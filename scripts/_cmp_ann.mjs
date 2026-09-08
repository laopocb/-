import { readFileSync } from 'node:fs';
const r = readFileSync('d:/lm/w/_ref_zip/index.js', 'utf8');
console.log('呼吸 sin 缩放:', r.includes('0.12 * Math.sin'));
const i = r.indexOf('_calculateScreenSpaceScale(viewDepth)');
const i2 = r.indexOf('setLocalScale(scale, scale, scale)');
console.log(r.slice(i - 200, i2 + 80));
// activate/deactivate 事件区
console.log('--- activate 切换 ---');
const a = r.indexOf("script.annotation._setMarkerActive = true") || r.indexOf('_setMarkerActive(true)');
const a2 = r.indexOf("_setMarkerActive(true)");
console.log('a2 pos:', a2);
if (a2 > 0) console.log(r.slice(a2 - 350, a2 + 250));