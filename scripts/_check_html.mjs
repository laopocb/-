for (const u of ['http://127.0.0.1:8123/img/cover.jpg', 'http://127.0.0.1:8123/img/%E7%83%AD%E7%82%B9%E6%A0%87%E8%AE%B0.png', 'http://127.0.0.1:8123/img/%E7%83%AD%E7%82%B9%E6%A0%87%E8%AE%B01.png', 'http://127.0.0.1:8123/img/%E7%83%AD%E7%82%B9%E6%A0%87%E8%AE%B0-%E6%BF%80%E6%B4%BB.png']) {
  try {
    const r = await fetch(u);
    console.log(r.status, r.headers.get('content-type'), u.split('/').pop());
  } catch (e) {
    console.log('ERR', String(e).slice(0, 80), u.split('/').pop());
  }
}