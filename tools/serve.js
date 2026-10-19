// Локальный сервер для просмотра AutoKiCad в браузере: node tools/serve.js [порт]
// Затем откройте http://127.0.0.1:8765
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = +process.argv[2] || 8765;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip', '.net': 'text/plain; charset=utf-8' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  // только файлы внутри папки проекта
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('403'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Не найдено: ' + p); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
// порт занят другой программой — берём следующий
let port = PORT;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && port < PORT + 50) { console.log(`Порт ${port} занят, пробую ${port + 1}…`); server.listen(++port, '127.0.0.1'); }
  else throw e;
});
server.on('listening', () => console.log(`AutoKiCad: http://127.0.0.1:${port}  (остановить — Ctrl+C)`));
server.listen(port, '127.0.0.1');
