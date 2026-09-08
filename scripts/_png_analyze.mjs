/* 分析 PNG 的 alpha 包围盒（无需第三方依赖），算出光效实际直径，用于等比换算屏幕像素 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function decodePng(file){
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('not png ' + file);
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
  if (colorType !== 6 || bitDepth !== 8) throw new Error(`unsupported colorType=${colorType} bit=${bitDepth}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++){
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++){
      const a = line[x];
      const b = x >= 4 ? cur[x - 4] : 0;
      const c = prev[x];
      const d = x >= 4 ? prev[x - 4] : 0;
      let v = a;
      if (f === 1) v = a + b;
      else if (f === 2) v = a + c;
      else if (f === 3) v = a + ((b + c) >> 1);
      else if (f === 4) {
        const p = b + c - d, pa = Math.abs(p - b), pb = Math.abs(p - c), pc = Math.abs(p - d);
        v = a + (pa <= pb && pa <= pc ? b : pb <= pc ? c : d);
      }
      cur[x] = v & 0xFF;
    }
    prev = cur;
  }
  return { width, height, rgba: out };
}

for (const name of ['热点标记.png', '热点标记1.png', '热点标记-激活.png']) {
  const img = decodePng(join(ROOT, 'img', name));
  const { width, height, rgba } = img;
  let minX = width, minY = height, maxX = -1, maxY = -1, opaque = 0, semi = 0;
  const thr = 8; // alpha > 8 视为可见像素
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgba[(y * width + x) * 4 + 3];
      if (a > thr) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (a > 200) opaque++;
      } else if (a > 0) semi++;
    }
  }
  const d = Math.max(maxX - minX + 1, maxY - minY + 1);
  console.log(`[${name}] ${width}x${height} alpha包围盒=(${minX},${minY})-(${maxX},${maxY}) 直径≈${d}px 占比=${(d / width * 100).toFixed(0)}% 实心像素=${opaque} 半透明=${semi}`);
  console.log(`    → 屏幕等比系数(原64px画布/56px圆≈25px肉眼): 想让光效=25px时 缩放=纹理宽/光效直径=${(width / d).toFixed(2)}x`);
}