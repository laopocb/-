import { readFileSync, writeFileSync } from 'node:fs';
const r = readFileSync('d:/lm/w/_ref_zip/index.js', 'utf8');
const start = r.indexOf('this._markerKey = this.label;');
// 从 "// Create texture" 前一点开始
const s0 = r.indexOf('        // Create texture', start - 500);
if (s0 < 0) { console.log('not found'); process.exit(1); }
// 找 _setMarkerActive 定义结束（到 join 之前）：取到 "this._setMarkerActive = (active) => {...};" 的结尾
const end = r.indexOf('this._setMarkerActive = (active) =>', start);
const end2 = r.indexOf('\n        };', end);
const seg = r.slice(s0, end2 + '\n        };'.length);
writeFileSync('d:/lm/w/_ref_zip/_ann_segment.txt', seg);
console.log('提取长度:', seg.length);
console.log('---- 开头 40 行 ----');
console.log(seg.split('\n').slice(0, 40).join('\n'));
console.log('---- 结尾 40 行 ----');
console.log(seg.split('\n').slice(-40).join('\n'));