// 极简静态文件服务器：验证部署包在纯静态环境可运行（与 serve.mjs 不同，无 /data /img 特殊映射）
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] || process.cwd());
const PORT = Number(process.env.PORT || process.argv[3] || 8126);

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
    '.obj': 'text/plain', '.ply': 'application/octet-stream', '.bin': 'application/octet-stream',
    '.wasm': 'application/wasm'
};

createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 ' + p); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' });
    createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`static ${ROOT} → http://127.0.0.1:${PORT}/`));