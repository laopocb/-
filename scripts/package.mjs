/* 静态部署打包：把构建产物 + 页面实际引用的 data/img 资源组装为自包含文件夹 deploy_时间戳/（并生成同名 zip）
 * 用法：node scripts/package.mjs  [outDir]  （默认 d:\lm\w\deploy_YYYYMMDD_HHmmss）
 *
 * 图片打包原则（按“用的打、不用的不打”）：
 *   - data/点位、data/箭头 等：只复制 settings.json（当前使用的版本）中 annotations[].image 实际引用到的文件，
 *     目录里多余/未引用的素材一律不打包；
 *   - img/：只复制运行时确实被引用的 6 张（封面 cover、光环 halo、莲花 lotus、热点标记-激活、箭头 jt、全景 pano）
 *     以及 settings 中无路径前缀引用的 img 素材；
 *   - settings.json：打包时显式用根目录当前版本覆盖，杜绝打入旧配置。
 */
import { cp, mkdir, rm, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ts = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();
const OUT = resolve(process.argv[2] || join(ROOT, `deploy_${ts}`));
const DIST = join(ROOT, 'dist');
const DATA = join(ROOT, 'data');
const IMG = join(ROOT, 'img');
const SETTINGS = join(ROOT, 'settings.json');

// —— 非图片、必须随包的分发数据（排除未使用的 point_wlbwg.ply/体素、geojson、三维源文件等）——
const DATA_FILES = [
    'wd.compressed.ply',
    '1.obj',
    '1.collision.glb'
];

// —— 运行时画面上确实用到的 img 固定素材（封面/莲花/光环/标注图标/箭头/全景）——
const IMG_REQUIRED = ['cover.jpg', 'halo.png', 'lotus.png', '热点标记-激活.png', 'jt.png', 'pano.jpg'];

const fmt = (n) => (n / 1048576).toFixed(1) + ' MB';

async function copyFileRel(srcDir, rel, label) {
    const s = join(srcDir, rel);
    const d = join(OUT, label, rel);
    if (!existsSync(s)) { console.warn(`  [缺] ${label}/${rel}`); return 0; }
    await mkdir(join(d, '..'), { recursive: true });
    await cp(s, d);
    return (await stat(s)).size;
}

const main = async () => {
    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });
    console.log('=== 组装静态包 → ' + OUT + ' ===');

    // 0) 读取当前使用的 settings.json，收集被引用的图片（相对路径）
    const settings = JSON.parse(await readFile(SETTINGS, 'utf8'));
    const usedData = new Set();   // 相对 data/ 的路径：点位/A1.jpg、箭头/jt.png
    const usedImg = new Set();    // 相对 img/ 的无前缀素材名
    for (const a of settings.annotations || []) {
        const img = String(a.image || '').trim();
        if (!img) continue;
        if (img.includes('/')) usedData.add(img);
        else usedImg.add(img);
    }
    console.log(`  [settings] 当前版本引用图片 × ${usedData.size + usedImg.size}（data 相对 ${usedData.size} / img 素材 ${usedImg.size}）`);

    // 1) dist 构建产物（页面 + 引擎 + 模块 + vendor + settings.json）
    let total = 0;
    for (const f of await readdir(DIST)) {
        await cp(join(DIST, f), join(OUT, f), { recursive: true });
        const st = await stat(join(OUT, f));
        total += st.isDirectory() ? (await dirSize(join(OUT, f))) : st.size;
    }
    // 用根目录当前 settings.json 覆盖 dist 副本，确保打包的一定是正在使用的配置
    await writeFile(join(OUT, 'settings.json'), await readFile(SETTINGS, 'utf8'), 'utf8');
    console.log(`  [dist] 已复制；settings.json 已用当前版本覆盖`);

    // 2) data（ply/obj/碰撞体 + settings 引用的点位图/箭头图，未引用的一律不打）
    for (const rel of DATA_FILES) {
        total += await copyFileRel(DATA, rel, 'data');
    }
    let dataImg = 0;
    for (const rel of [...usedData].sort()) {
        const sz = await copyFileRel(DATA, rel, 'data');
        if (sz > 0) dataImg++;
        total += sz;
    }
    console.log(`  [data] 已复制核心文件 ${DATA_FILES.length} 个 + 引用图片 ${dataImg} 个（未引用素材不打包）`);

    // 3) img（固定必需的 6 张 + settings 无前缀引用的素材，其余如旧素材/替换图一律不打）
    let imgN = 0;
    for (const f of [...new Set([...IMG_REQUIRED, ...usedImg])]) {
        const sz = await copyFileRel(IMG, f, 'img');
        if (sz > 0) imgN++;
        total += sz;
    }
    console.log(`  [img] 已复制 ${imgN} 个（必需 ${IMG_REQUIRED.length} + settings 引用 ${usedImg.size}，无用的不打包）`);

    console.log(`=== 完成：包总大小 ${fmt(total)} ===`);
    console.log('  关键文件:');
    const anchors = ['index.html', 'index.js', 'settings.json', 'data/wd.compressed.ply', 'data/1.collision.glb', 'img/jt.png', 'img/热点标记-激活.png'];
    for (const rel of anchors) {
        const p = join(OUT, rel);
        if (existsSync(p)) console.log(`    ${' '.repeat(20)} ${rel}  ${fmt((await stat(p)).size)}`);
        else console.log(`    ${' '.repeat(20)} ${rel}  [缺!]`);
    }
    console.log(`  data/点位 打包 ${[...usedData].filter((r) => r.startsWith('点位/')).length} 张（共 ${usedData.size} 引用）`);

    // 4) 生成同名 zip（PowerShell Compress-Archive；文件名英文+时间戳，避免中文路径问题）
    try {
        const zip = `${OUT}.zip`;
        const r = spawnSync('powershell', [
            '-NoProfile', '-Command',
            `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zip}' -Force`
        ], { encoding: 'utf8', timeout: 600000, windowsHide: true });
        if (r.status === 0 && existsSync(zip)) {
            total += (await stat(zip)).size;
            console.log(`  [zip] ${basename(zip)}  ${fmt((await stat(zip)).size)}`);
        } else {
            console.warn(`  [zip] 压缩失败：${String(r.stderr || r.stdout || 'unknown').trim().slice(0, 300)}`);
        }
    } catch (e) {
        console.warn(`  [zip] 跳过（${e.message}）`);
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