/**
 * relocate_points.mjs —— 按 KML 重新校准标注点坐标
 * ------------------------------------------------------------
 * 规则：KML 每个 Placemark 的 <name>N_点</name> 对应该序号标注，
 *       坐标 <coordinates>a,b,c</coordinates> 为 (x, -z, y)（翻转后的 Y-up 场景系），
 *       写入 settings.json 中该序号的 position = [a, c, -b]。
 * 不改动 title / text / image 等其它字段。
 *
 * 用法：node scripts/relocate_points.mjs <标注.kml>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const kmlPath = resolve(process.argv[2] || 'c:/Users/Administrator/.trae-cn/attachments/6a9b777656d497980b00619b/3ddcb3d7-d245-4efe-82d2-d1a0da700d62_26650b1c-7fe3-4396-823d-809e41765220_标注.kml');
const settingsPath = resolve('settings.json');

const main = async () => {
    const kml = await readFile(kmlPath, 'utf8');
    const re = /<name>(\d+)_点<\/name>[\s\S]*?<coordinates>\s*([-\d.eE+]+),([-\d.eE+]+),([-\d.eE+]+)\s*<\/coordinates>/g;
    const map = new Map();
    let m;
    while ((m = re.exec(kml)) !== null) {
        const n = parseInt(m[1], 10);
        const a = parseFloat(m[2]), b = parseFloat(m[3]), c = parseFloat(m[4]);
        if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) {
            map.set(n, { x: a, y: c, z: -b });   // (x, -z, y) → (x, y, z)
        }
    }
    console.log(`KML 解析到标注点：${map.size} 个`);

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    const anns = settings.annotations || [];
    let changed = 0, missing = 0;
    anns.forEach((ann, i) => {
        const n = i + 1;
        const p = map.get(n);
        if (p) {
            const same = ann.position && Math.abs(ann.position[0] - p.x) < 1e-6 && Math.abs(ann.position[1] - p.y) < 1e-6 && Math.abs(ann.position[2] - p.z) < 1e-6;
            if (!same) { ann.position = [p.x, p.y, p.z]; changed++; }
        } else {
            missing++;
        }
    });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log(`已更新 position：${changed} 个；KML/序号缺失（保留原坐标）：${missing} 个`);
};

main().catch((e) => { console.error('失败：', e); process.exit(1); });