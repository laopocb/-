/**
 * 零依赖本地静态服务器
 * --------------------------------------------------------------------------
 * 1. 伺服 dist/ 目录（构建产物：index.html / index.js / index.css / settings.json）；
 * 2. 把 /data/* 直接映射到项目根 data/ 目录 —— 148MB 的 ply 不复制到 dist（零拷贝）；
 * 3. 支持 Range 请求（大文件流式读取）；
 * 4. 正确的 MIME 类型（.ply / .sog / .splat 走 application/octet-stream）。
 *
 * 用法：node scripts/serve.mjs [端口]（默认 8123，环境变量 PORT 亦可指定）
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url))); // D:\lm\w
const DIST_DIR = join(ROOT_DIR, 'dist');
const DATA_DIR = join(ROOT_DIR, 'data'); // ply 数据源目录（直接映射，不复制）
const IMG_DIR = join(ROOT_DIR, 'img'); // 标注图片资源（直接映射，不复制）
const DEFAULT_PORT = Number(process.env.PORT) || 8123;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.geojson': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.sog': 'application/octet-stream',
    '.ply': 'application/octet-stream',
    '.splat': 'application/octet-stream',
    '.spz': 'application/octet-stream',
    '.wasm': 'application/wasm'
};

/**
 * 把 URL 路径解析到磁盘安全路径。
 * - /data/* → 项目根 data/ 目录
 * - 其他      → dist/ 目录
 * 做了目录穿越防护（normalize + 前缀校验）。
 */
const resolveSafePath = (urlPath) => {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch {
        return { ok: false, status: 400, message: '请求路径无法解码' };
    }
    const pathname = decoded.split('?')[0];

    // 目录穿越防护的公共校验
    const guard = (baseDir, rest) => {
        const candidate = normalize(join(baseDir, rest));
        const prefix = baseDir + sep;
        if (candidate !== baseDir && !candidate.startsWith(prefix)) {
            return null;
        }
        return candidate;
    };

    if (pathname === '/data' || pathname.startsWith('/data/')) {
        const rest = pathname === '/data' ? '' : pathname.slice('/data'.length);
        const candidate = guard(DATA_DIR, rest);
        return candidate ? { ok: true, filePath: candidate } : { ok: false, status: 403, message: '禁止访问目录之外的路径' };
    }

    if (pathname === '/img' || pathname.startsWith('/img/')) {
        const rest = pathname === '/img' ? '' : pathname.slice('/img'.length);
        const candidate = guard(IMG_DIR, rest);
        return candidate ? { ok: true, filePath: candidate } : { ok: false, status: 403, message: '禁止访问目录之外的路径' };
    }

    const candidate = guard(DIST_DIR, pathname);
    return candidate ? { ok: true, filePath: candidate } : { ok: false, status: 403, message: '禁止访问目录之外的路径' };
};

/** 解析单区间 Range 头："bytes=start-end" */
const parseRange = (req, fileSize) => {
    const header = req.headers.range;
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null;
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : fileSize - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= fileSize) return null;
    return { start, end: Math.min(end, fileSize - 1) };
};

const sendJson = (res, statusCode, data) => {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
    });
    res.end(body);
};

const sendFile = async (req, res, filePath) => {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
        sendJson(res, 404, { error: '未找到文件' });
        return;
    }

    const mime = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = parseRange(req, fileStat.size);

    if (range) {
        res.writeHead(206, {
            'Content-Type': mime,
            'Content-Length': range.end - range.start + 1,
            'Content-Range': `bytes ${range.start}-${range.end}/${fileStat.size}`,
            'Accept-Ranges': 'bytes'
        });
        createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
        return;
    }

    res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': fileStat.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
    });
    createReadStream(filePath).pipe(res);
};

const handleRequest = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = url.pathname;

    // 根路径 → index.html
    if (pathname === '/') pathname = '/index.html';

    const safePath = resolveSafePath(pathname);
    if (!safePath.ok) {
        sendJson(res, safePath.status, { error: safePath.message });
        return;
    }

    try {
        await sendFile(req, res, safePath.filePath);
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            sendJson(res, 404, { error: `未找到资源：${pathname}` });
        } else {
            sendJson(res, 500, { error: '服务器内部错误' });
        }
    }
};

const port = Number(process.argv[2]) || DEFAULT_PORT;

const server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
        if (!res.headersSent) {
            sendJson(res, 500, { error: '服务器内部错误' });
        } else {
            res.end();
        }
    });
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Server running at http://127.0.0.1:${port}/`);
    console.log(`数据映射: /data/point_wlbwg.compressed.ply → ${join(DATA_DIR, 'point_wlbwg.compressed.ply')}`);
});
