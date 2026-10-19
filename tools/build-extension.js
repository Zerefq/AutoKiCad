// Сборка расширения EasyEDA: index.html + css + js → easyeda-extension/ui.txt (один файл; EasyEDA принимает в расширениях только js/json/txt/svg/png/md).
// Запуск: node tools/build-extension.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'easyeda-extension');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const safe = s => s.replace(/<\/script/gi, '<\\/script');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, f) => `<style>\n${read(f)}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, f) => `<script>\n// ---- ${f} ----\n${safe(read(f))}\n</script>`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'ui.txt'), html);
console.log('easyeda-extension/ui.txt:', Math.round(html.length / 1024), 'КБ');
