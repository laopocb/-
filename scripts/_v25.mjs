const j = await (await fetch('http://127.0.0.1:8123/index.js')).text();
const p = await (await fetch('http://127.0.0.1:8123/annotations-poster.js?v=25')).text();
const w = await (await fetch('http://127.0.0.1:8123/wall-layer.js?v=25')).text();
console.log('index 内部放行判定:', j.includes("up.y > cp.y"));
console.log('poster v25 内部放行:', p.includes("up.y > p.y"));
console.log('wall v25 默认透明(关):', w.includes("get('wall') === '1'"));