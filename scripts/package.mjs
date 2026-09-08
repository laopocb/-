/* 静态部署打包：把构建产物 + 页面实际引用的 data/img 资源组装为自包含文件夹 deploy/（含 zip）
 * 用法：node scripts/package.mjs  [outDir]  （默认 d:\lm\w\deploy）
 */
import { cp, mkdir, rm, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || join(ROOT, 'deploy'));
const DIST = join(ROOT, 'dist');
const DATA = join(ROOT, 'data');
const IMG = join(ROOT, 'img');

// —— 页面实际引用的 data 资源（排除未使用的 point_wlbwg.ply/体素、geojson、三维源文件等）——
const DATA_FILES = [
    'wd.compressed.ply',
    '1.obj',
    '1.collision.glb'
];
const IMG_ALL = ['.jpg', '.png', '.jpeg', '.webp'];

const fmt = (n) => (n / 1048576).toFixed(1) + ' MB';

async function copyTree(srcDir, list, label) {
    let total = 0;
    for (const rel of list) {
        const s = join(srcDir, rel);
        const d = join(OUT, label, rel);
        if (!existsSync(s)) { console.warn(`  [缺] ${label}/${rel}`); continue; }
        await mkdir(join(d, '..'), { recursive: true });
        await cp(s, d);
        total += (await stat(s)).size;
    }
    return total;
}

const main = async () => {
    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });
    console.log('=== 组装静态包 → ' + OUT + ' ===');

    // 1) dist 构建产物（页面 + 引擎 + 模块 + vendor）
    let total = 0;
    for (const f of await readdir(DIST)) {
        await cp(join(DIST, f), join(OUT, f), { recursive: true });
        const st = await stat(join(OUT, f));
        total += st.isDirectory() ? (await dirSize(join(OUT, f))) : st.size;
    }
    console.log(`  [dist] 已复制`);

    // 2) data（ply/obj/碰撞体/点位图：点位目录整目录打包，含全部新增图）
    total += await copyTree(DATA, DATA_FILES, 'data');
    const POINTS_SRC = join(DATA, '点位');
    if (existsSync(POINTS_SRC)) {
        await cp(POINTS_SRC, join(OUT, 'data', '点位'), { recursive: true });
        const pts = await readdir(POINTS_SRC);
        const sz = await dirSize(POINTS_SRC);
        total += sz;
        console.log(`  [data] 点位图片已整目录打包 × ${pts.length}（共 ${fmt(sz)}）`);
    }

    // 3) img（封面/莲花/光环/标注图：仅打包运行时实际引用的，排除无用素材）
    const imgExt = ['.jpg', '.jpeg', '.png', '.webp'];
    const imgSkip = new Set(['热点标记.png', '热点标记1.png', 'd8a4.png', 'b1.png', 'b2.png', 'b3.png', 'IMG_980.jpg']);
    const imgs = (await readdir(IMG)).filter((f) => !f.startsWith('_') && !imgSkip.has(f) && imgExt.includes(f.slice(f.lastIndexOf('.')).toLowerCase()));
    total += await copyTree(IMG, imgs, 'img');
    console.log(`  [img] 已复制 ${imgs.length} 个（排除无用素材）`);

    console.log(`=== 完成：包总大小 ${fmt(total)} ===`);
    console.log('  文件清单:');
    for (const rel of ['index.html', 'index.js', 'index.css', 'settings.json', 'camlog.js', 'wall-layer.js', 'annotations-poster.js', 'vendor/three.module.js', ...DATA_FILES.map((f) => 'data/' + f), ...imgs.map((f) => 'img/' + f)]) {
        const p = join(OUT, rel);
        if (existsSync(p)) console.log(`    ${rel}  ${fmt((await stat(p)).size)}`);
        else console.log(`    ${rel}  [缺!]`);
    }
};

async function dirSize(dir) {
    let s = 0;
    for (const f of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        s += f.isDirectory() ? await dirSize(p) : (await stat(p)).size;
    }
    return s;
}

main().catch((e) => { console.error('打包失败：', e); process.exit(1); });