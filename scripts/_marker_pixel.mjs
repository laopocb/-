/* 像素级检查用户上传的标记图：中心/环/边缘处的 RGBA 与 alpha 包围盒 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('not png');
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
  if (colorType !== 6 || bitDepth !== 8) throw new Error(`colorType=${colorType} bit=${bitDepth}`);
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
function summarize(file) {
  const img = decodePng(file);
  const { width, height } = img;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (img.rgba[(y * width + x) * 4 + 3] > 4) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  console.log(`\n=== ${file.split(/[\\/]/).pop()}  ${width}x${height}  alpha包围盒 x[${minX},${maxX}] y[${minY},${maxY}]`);
  const pts = [['中心', 0.5, 0.5], ['中心偏左0.45', 0.45, 0.5], ['内环0.35', 0.35, 0.5], ['环峰0.28', 0.28, 0.5], ['外晕0.18', 0.18, 0.5], ['极外0.06', 0.06, 0.5]];
  for (const [label, xf, yf] of pts) {
    const [r, g, b, a] = sample(img, xf, yf);
    console.log(`   ${label.padEnd(8)} RGBA=(${r},${g},${b},${a}) ${a < 4 ? '[透明]' : (r < 40 && g < 40 && b < 40 ? '[黑心!]' : '')}`);
  }
}
summarize('c:/Users/Administrator/.trae-cn/attachments/6a9b777656d497980b00619b/69694ebb-6836-411c-bd2d-f577402bbd1d_8d90fbb5-9421-4588-8779-2d78b541c8b1_热点标记.png');
summarize('c:/Users/Administrator/.trae-cn/attachments/6a9b777656d497980b00619b/2edefc86-dc4f-419a-94a1-71d2a4e897fb_69aebdaf-3b68-47d1-be25-6bd4f884e318_热点标记1.png');