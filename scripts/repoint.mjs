/**
 * repoint.mjs —— 把 data/点位 的图片重新与 settings.json 标注点匹配
 * ------------------------------------------------------------
 * 规则（用户确认）：
 *   1. 标注 {n}_点 → 优先 A{n}.jpg（A47.JPG / A65.JPG 大写扩展名也认）；
 *   2. 纯数字名 {n}.jpg（如 84.jpg）也直接对应该序号；
 *   3. 缺号点位 → 按文件名数字升序依次消费 IMG_xxxx.jpg；
 *   4. 都无 → 回退 A1.jpg。
 * 用法：node scripts/repoint.mjs   （就地更新 settings.json，随后重新 build）
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POINT_DIR = join(ROOT, 'data', '点位');
const SETTINGS = join(ROOT, 'settings.json');

const main = async () => {
    const files = await readdir(POINT_DIR);
    const base = (f) => f.replace(/\.(jpg|jpeg|png)$/i, '');

    const aMap = new Map();   // 序号 → 「A{序号}」文件名
    const numMap = new Map(); // 序号 → 纯数字文件名（84.jpg）
    const imgs = [];          // IMG_xxxx.jpg，按数字升序

    for (const f of files) {
        const b = base(f);
        let m = /^A(\d+)$/i.exec(b);
        if (m) { aMap.set(parseInt(m[1], 10), f); continue; }
        m = /^(\d+)$/.exec(b);
        if (m) { numMap.set(parseInt(m[1], 10), f); continue; }
        m = /^IMG_(\d+)$/i.exec(b);
        if (m) { imgs.push({ n: parseInt(m[1], 10), f }); }
    }
    imgs.sort((x, y) => x.n - y.n);

    const settings = JSON.parse(await readFile(SETTINGS, 'utf8'));
    const anns = settings.annotations || [];
    if (!anns.length) throw new Error('settings.json 无 annotations');

    const queue = imgs.map((x) => x.f);
    const stats = { A: 0, num: 0, img: 0, fb: 0 };
    const rows = [];

    anns.forEach((ann, i) => {
        const n = i + 1;
        let img = aMap.get(n);
        let src = 'A';
        if (!img) {
            img = numMap.get(n);
            src = 'num';
        }
        if (!img) {
            img = queue.shift();
            src = 'img';
        }
        if (!img) { img = 'A1.jpg'; src = 'fb'; }

        if (src === 'A') stats.A++;
        else if (src === 'num') stats.num++;
        else if (src === 'img') stats.img++;
        else stats.fb++;

        ann.image = `点位/${img}`;
        rows.push(`${n}\t${img}`);
    });

    await writeFile(SETTINGS, JSON.stringify(settings, null, 2), 'utf8');
    console.log(`=== 匹配完成：标注共 ${anns.length} 个 ===`);
    console.log(`A{序号} 命中：${stats.A}   纯数字名命中：${stats.num}   IMG 补缺：${stats.img}   回退 A1：${stats.fb}`);
    console.log('--- 逐个点位映射（序号 → 图片） ---');
    console.log(rows.join('\n'));
};

main().catch((e) => { console.error('失败：', e); process.exit(1); });