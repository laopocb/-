/**
 * repoint.mjs —— 把 data/点位 的图片重新与 settings.json 标注点匹配（KML name 数字版）
 * ------------------------------------------------------------
 * 规则（用户确认）：
 *   1. 图片名规范：A后面的数字 与 标注 title（即 KML <name>N_点</name>）的数字一一对应；
 *      标注数字取 title 前缀（如 "60_点" → 60），与数组位置无关（删除点位后不错位）。
 *   2. 支持 "A18 (2).jpg" / "A40(1).jpg" 这类带括号副本：同名(同数字)多文件时取 LastWriteTime 最新者。
 *   3. 纯数字名 {n}.jpg（如 84.jpg）也直接对应序号 n。
 *   4. 都没有 → 回退 A1.jpg。
 * 用法：node scripts/repoint.mjs [可选: 点位目录]
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ROOT = resolve('.');
const POINT_DIR = resolve(process.argv[2] || join(ROOT, 'data', '点位'));
const SETTINGS = join(ROOT, 'settings.json');

const main = async () => {
    const files = await readdir(POINT_DIR);
    const statMap = new Map();
    for (const f of files) {
        statMap.set(f, (await stat(join(POINT_DIR, f))).mtimeMs);
    }

    const aMap = new Map();   // 序号 → { file, mtime }
    const numMap = new Map(); // 序号 → 纯数字文件名
    const pick = (map, n, file, mtime) => {
        const cur = map.get(n);
        if (!cur || mtime > cur.mtime) map.set(n, { file, mtime });
    };

    for (const f of files) {
        const dot = f.lastIndexOf('.');
        const base = dot >= 0 ? f.slice(0, dot) : f;
        const ext = dot >= 0 ? f.slice(dot).toLowerCase() : '';
        if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') continue;

        let m = /^A(\d+)\s*(?:\(\d+\))?$/i.exec(base); // A18 / A18 (2) / A40(1)
        if (m) { pick(aMap, parseInt(m[1], 10), f, statMap.get(f)); continue; }

        m = /^(\d+)\s*(?:\(\d+\))?$/.exec(base); // 84.jpg
        if (m) { pick(numMap, parseInt(m[1], 10), f, statMap.get(f)); continue; }
    }

    const settings = JSON.parse(await readFile(SETTINGS, 'utf8'));
    const anns = settings.annotations || [];
    if (!anns.length) throw new Error('settings.json 无 annotations');

    const stats = { A: 0, num: 0, fb: 0 };
    const rows = [];

    anns.forEach((ann) => {
        // 标注序号 = title 前缀数字（"8_点" → 8），与数组位置无关
        const titleNum = /^\d+/.exec(ann.title || '');
        const n = titleNum ? parseInt(titleNum[0], 10) : null;
        let img = null;
        if (n !== null && aMap.has(n)) { img = aMap.get(n).file; stats.A++; }
        else if (n !== null && numMap.has(n)) { img = numMap.get(n).file; stats.num++; }
        else { img = 'A1.jpg'; stats.fb++; }
        ann.image = `点位/${img}`;
        rows.push(`${ann.title || n}\t${img}`);
    });

    await writeFile(SETTINGS, JSON.stringify(settings, null, 2), 'utf8');
    console.log(`=== 匹配完成：标注共 ${anns.length} 个，图片 ${files.length} 张 ===`);
    console.log(`A{title数字} 命中：${stats.A}   纯数字名命中：${stats.num}   回退 A1：${stats.fb}`);
    console.log('--- 映射明细（title → 图片） ---');
    console.log(rows.join('\n'));
};

main().catch((e) => { console.error('失败：', e); process.exit(1); });