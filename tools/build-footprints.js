// Сборка js/footprints.js из библиотеки посадочных мест KiCad (*.kicad_mod).
// Берутся все посадочные места, на которые ссылаются компоненты (footprint и fpAlt) и примеры.
// Запуск: node tools/build-footprints.js [путь к share/kicad/footprints]
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const LIBDIR = process.argv[2] || 'D:/Madamin/Programs/KiCad/share/kicad/footprints';

// ---- список нужных посадочных мест ----
const ctx = { console, Math, JSON, Date, Set, Map, Object, Array, String, Number, RegExp, isFinite, Infinity, NaN, parseFloat };
ctx.window = ctx;
vm.createContext(ctx);
['util', 'components', 'pcb', 'examples'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx));
const AK = ctx.AK;
const need = new Set();
Object.values(AK.LIB).forEach(d => { if (d.footprint) need.add(d.footprint); (d.fpAlt || []).forEach(f => need.add(f)); });
// примеры при сборке обращаются к AK.FOOTPRINTS — подставляем заглушку, которая запоминает имена
AK.FOOTPRINTS = new Proxy({}, { get: (t, k) => { need.add(k); return { pads: [{ x: 0, y: 0 }], silk: [], fab: [], crt: [0, 0, 0, 0] }; } });
AK.EXAMPLES.forEach(ex => ex.build().components.forEach(c => { if (c.fp) need.add(c.fp); }));

// ---- разбор S-выражений ----
function parse(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  function node() {
    ws();
    if (src[i] === '(') {
      i++;
      const out = [];
      for (;;) { ws(); if (src[i] === ')') { i++; return out; } out.push(node()); }
    }
    if (src[i] === '"') {
      let s = '';
      i++;
      while (src[i] !== '"') { if (src[i] === '\\') i++; s += src[i++]; }
      i++;
      return { s };
    }
    let a = '';
    while (i < src.length && !/[\s()]/.test(src[i])) a += src[i++];
    return a;
  }
  return node();
}
const str = v => (v && typeof v === 'object' && 's' in v ? v.s : v);
const kids = (n, name) => n.filter(x => Array.isArray(x) && x[0] === name);
const kid = (n, name) => kids(n, name)[0];
const num = v => +str(v);
const r3 = v => Math.round(v * 1000) / 1000;

function arcPts(s, m, e) {
  // окружность по трём точкам
  const [ax, ay] = s, [bx, by] = m, [cx, cy] = e;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [s, e];
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  let a1 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a2 = Math.atan2(cy - uy, cx - ux);
  // направление обхода — через среднюю точку
  const norm = a => (a + Math.PI * 4) % (Math.PI * 2);
  let sweep = norm(a2 - a1);
  if (norm(am - a1) > sweep) sweep -= Math.PI * 2;
  const n = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
  const pts = [];
  for (let k = 0; k <= n; k++) { const a = a1 + sweep * k / n; pts.push([r3(ux + r * Math.cos(a)), r3(uy + r * Math.sin(a))]); }
  return pts;
}

function convert(name) {
  const [lib, fp] = name.split(':');
  const file = path.join(LIBDIR, lib + '.pretty', fp + '.kicad_mod');
  const t = parse(fs.readFileSync(file, 'utf8'));
  const out = { pads: [], silk: [], fab: [], crt: null };
  const at = n => { const a = kid(n, 'at'); return a ? [num(a[1]), num(a[2]), a[3] != null ? num(a[3]) : 0] : [0, 0, 0]; };
  const pt = (n, k) => { const a = kid(n, k); return [num(a[1]), num(a[2])]; };
  const layerOf = n => { const l = kid(n, 'layer'); return l ? str(l[1]) : ''; };
  const width = n => { const s = kid(n, 'stroke'); const w = s ? kid(s, 'width') : kid(n, 'width'); return w ? num(w[1]) : 0.12; };
  let cx1 = Infinity, cy1 = Infinity, cx2 = -Infinity, cy2 = -Infinity;
  t.forEach(n => {
    if (!Array.isArray(n)) return;
    if (n[0] === 'pad') {
      const [x, y, rot] = at(n);
      const size = kid(n, 'size');
      const dr = kid(n, 'drill');
      let drill = 0;
      if (dr) drill = str(dr[1]) === 'oval' ? [num(dr[2]), num(dr[3] != null && !Array.isArray(dr[3]) ? dr[3] : dr[2])] : num(dr[1]);
      const layers = (kid(n, 'layers') || []).slice(1).map(str);
      const rr = kid(n, 'roundrect_rratio');
      const p = { n: str(n[1]), k: str(n[2]), sh: str(n[3]), x: r3(x), y: r3(y), w: r3(num(size[1])), h: r3(num(size[2])) };
      // поворот площадки храним по часовой стрелке (в KiCad — против)
      if (rot) p.r = -rot;
      if (drill) p.d = Array.isArray(drill) ? drill.map(r3) : r3(drill);
      if (rr) p.rr = r3(num(rr[1]));
      p.l = layers.some(l => l === '*.Cu') ? '*' : layers.includes('B.Cu') ? 'B' : 'F';
      if (p.sh === 'custom') p.sh = 'rect';
      out.pads.push(p);
      return;
    }
    const layer = layerOf(n);
    const dst = layer === 'F.SilkS' ? out.silk : layer === 'F.Fab' ? out.fab : null;
    const isCrt = layer === 'F.CrtYd';
    let pts = null, closed = false;
    if (n[0] === 'fp_line') pts = [pt(n, 'start'), pt(n, 'end')];
    else if (n[0] === 'fp_rect') { const [a, b] = [pt(n, 'start'), pt(n, 'end')]; pts = [a, [b[0], a[1]], b, [a[0], b[1]], a]; }
    else if (n[0] === 'fp_circle') {
      const c = pt(n, 'center'), e = pt(n, 'end'), r = Math.hypot(e[0] - c[0], e[1] - c[1]);
      pts = [];
      for (let k = 0; k <= 32; k++) pts.push([r3(c[0] + r * Math.cos(k * Math.PI / 16)), r3(c[1] + r * Math.sin(k * Math.PI / 16))]);
    } else if (n[0] === 'fp_arc') pts = arcPts(pt(n, 'start'), pt(n, 'mid'), pt(n, 'end'));
    else if (n[0] === 'fp_poly') { pts = kid(n, 'pts').filter(x => x[0] === 'xy').map(x => [num(x[1]), num(x[2])]); closed = true; }
    if (!pts) return;
    if (closed) pts.push(pts[0]);
    if (isCrt) pts.forEach(([x, y]) => { cx1 = Math.min(cx1, x); cy1 = Math.min(cy1, y); cx2 = Math.max(cx2, x); cy2 = Math.max(cy2, y); });
    else if (dst) dst.push({ w: r3(width(n)), p: pts.map(([x, y]) => [r3(x), r3(y)]) });
  });
  if (cx1 === Infinity) out.pads.forEach(p => { cx1 = Math.min(cx1, p.x - p.w / 2); cy1 = Math.min(cy1, p.y - p.h / 2); cx2 = Math.max(cx2, p.x + p.w / 2); cy2 = Math.max(cy2, p.y + p.h / 2); });
  out.crt = [r3(cx1), r3(cy1), r3(cx2), r3(cy2)];
  return out;
}

const FP = {};
[...need].sort().forEach(n => {
  try { FP[n] = convert(n); } catch (e) { console.log('нет в библиотеке:', n, e.message); }
});
const head = `// Посадочные места (мм, ось Y вниз) — сгенерировано tools/build-footprints.js из библиотеки KiCad.
// Источник: KiCad footprint library, https://gitlab.com/kicad/libraries/kicad-footprints
// Лицензия библиотеки: CC-BY-SA 4.0 с исключением — платы, созданные с её использованием, можно распространять
// без ограничений (https://www.kicad.org/libraries/license/).
// pads: n — номер, k — smd/thru_hole/np_thru_hole, sh — форма, x/y/w/h, r — поворот (° по часовой), d — сверло, l — F/B/* (слои меди)
window.AK = window.AK || {};
AK.FOOTPRINTS = `;
fs.writeFileSync(path.join(ROOT, 'js', 'footprints.js'), head + JSON.stringify(FP) + ';\n');
console.log('js/footprints.js:', Object.keys(FP).length, 'посадочных мест,', Math.round(fs.statSync(path.join(ROOT, 'js', 'footprints.js')).size / 1024), 'КБ');
