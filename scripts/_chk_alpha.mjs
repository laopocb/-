/* 分析当前默认标注图（热点标记-激活.png）与热点标记.png 的透明度/中央颜色 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(file) {
  const buf = readFileSync(file);
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = line[x], b = x >= 4 ? cur[x - 4] : 0, c = prev[x], d = x >= 4 ? prev[x - 4] : 0;
      let v = a;
      if (f === 1) v = a + b; else if (f === 2) v = a + c;
      else if (f === 3) v = a + ((b + c) >> 1);
      else if (f === 4) { const p = b + c - d, pa = Math.abs(p - b), pb = Math.abs(p - c), pc = Math.abs(p - d); v = a + (pa <= pb && pa <= pc ? b : pb <= pc ? c : d); }
      cur[x] = v & 0xFF;
    }
    prev = cur;
  }
  return { width, height, rgba: out };
}
function sample(img, xf, yf) {
  const x = Math.floor(img.width * xf), y = Math.floor(img.height * yf);
  const i = (y * img.width + x) * 4;
  return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]];
}
function summarize(file, isActive) {
  const img = decodePng(file);
  let minA = 255, maxA = 0;
  for (let i = 3; i < img.rgba.length; i += 4) { if (img.rgba[i] > maxA) maxA = img.rgba[i]; if (img.rgba[i] < minA) minA = img.rgba[i]; }
  console.log(`\n=== ${file.split(/[\\/]/).pop()}  ${img.width}x${img.height}  alpha范围[${minA},${maxA}] ===`);
  const pts = [['中心', 0.5, 0.5], ['偏右0.42', 0.58, 0.5], ['偏右0.35', 0.65, 0.5], ['边缘0.22', 0.78, 0.5], ['极外0.05', 0.95, 0.5]];
  for (const [label, xf, yf] of pts) {
    const [r, g, b, a] = sample(img, xf, yf);
    console.log(`   ${label.padEnd(7)} RGBA=(${r},${g},${b},${a}) ${a < 4 ? '[全透明]' : ''}${r+g+b < 180 ? ' [深色!]' : ''}`);
  }
}
summarize('d:/lm/w/img/热点标记-激活.png', true);
summarize('d:/lm/w/img/热点标记.png', false);