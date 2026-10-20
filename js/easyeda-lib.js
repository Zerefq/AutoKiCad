// Компоненты из библиотеки EasyEDA (JLCEDA/EasyEDA Official Library, https://lceda.cn/ · https://easyeda.com).
// Из данных компонента строятся: символ схемы (sym), вид на макетной плате (visual, по посадочному месту)
// и сведения для вставки «родного» символа EasyEDA (ee).
// Единицы EasyEDA: схема — 10 = 100 mil = 1 U; посадочное место — 10 = 100 mil = 10 px монтажа.
window.AK = window.AK || {};

AK.EE = (function () {
  const API = 'https://easyeda.com';
  const VER = '6.5.51';
  const LCSC_UID = '0819f05c4eef4c71ace90d822a990e87';
  const R3 = v => Math.round(v * 1000) / 1000;

  // ---------- SVG path → ломаные (M L H V A C Q Z) ----------
  function pathToPolylines(d) {
    const tok = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    const out = [];
    let i = 0, cmd = '', cur = [0, 0], start = [0, 0], line = null;
    const num = () => +tok[i++];
    const push = p => { if (!line) { line = [cur.slice()]; out.push(line); } line.push(p); cur = p; };
    while (i < tok.length) {
      if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const base = rel ? cur : [0, 0];
      if (C === 'M') { cur = [base[0] + num(), base[1] + num()]; start = cur; line = null; cmd = rel ? 'l' : 'L'; }
      else if (C === 'L') push([base[0] + num(), base[1] + num()]);
      else if (C === 'H') push([(rel ? cur[0] : 0) + num(), cur[1]]);
      else if (C === 'V') push([cur[0], (rel ? cur[1] : 0) + num()]);
      else if (C === 'Z') { if (line) push(start.slice()); line = null; }
      else if (C === 'C') { num(); num(); num(); num(); push([base[0] + num(), base[1] + num()]); }
      else if (C === 'Q' || C === 'S') { num(); num(); push([base[0] + num(), base[1] + num()]); }
      else if (C === 'A') {
        const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = num(), sweep = num();
        const p = [base[0] + num(), base[1] + num()];
        arcPoints(cur, p, rx, ry, rot, large, sweep).forEach(push);
      } else i++;
    }
    return out.filter(l => l.length > 1);
  }

  // дуга SVG по конечным точкам → точки (центральная параметризация)
  function arcPoints(p1, p2, rx, ry, phiDeg, fa, fs) {
    if (!rx || !ry) return [p2];
    const phi = phiDeg * Math.PI / 180, cs = Math.cos(phi), sn = Math.sin(phi);
    const dx = (p1[0] - p2[0]) / 2, dy = (p1[1] - p2[1]) / 2;
    const x1 = cs * dx + sn * dy, y1 = -sn * dx + cs * dy;
    let lam = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    let co = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    if (fa === fs) co = -co;
    const cxp = co * rx * y1 / ry, cyp = -co * ry * x1 / rx;
    const cx = cs * cxp - sn * cyp + (p1[0] + p2[0]) / 2, cy = sn * cxp + cs * cyp + (p1[1] + p2[1]) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
    let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI;
    if (fs && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12)));
    const pts = [];
    for (let k = 1; k <= n; k++) {
      const t = t1 + dt * k / n;
      pts.push([cx + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, cy + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs]);
    }
    pts[pts.length - 1] = p2;
    return pts;
  }

  // ---------- символ ----------
  const ELEC = { 1: 'in', 2: 'out', 4: 'pwr' };

  function parsePins(shapes) {
    const pins = [];
    shapes.filter(s => s.startsWith('P~')).forEach(s => {
      const seg = s.split('^^');
      const f = seg[0].split('~');
      const x = +f[4], y = +f[5];
      const m = (seg[2] || '').split('~')[0].match(/M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*([hvHVLl])\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?/);
      let dx = 0, dy = 0;
      if (m) {
        const c = m[3];
        if (c === 'h' || c === 'H') dx = c === 'h' ? +m[4] : +m[4] - +m[1];
        else if (c === 'v' || c === 'V') dy = c === 'v' ? +m[4] : +m[4] - +m[2];
        else if (c === 'L') { dx = +m[4] - +m[1]; dy = +m[5] - +m[2]; }
        else { dx = +m[4]; dy = +m[5]; }
      }
      const name = (seg[3] || '').split('~');
      const nm = (seg[4] || '').split('~');
      pins.push({
        num: f[3], x, y, dx, dy, hidden: f[1] !== 'show',
        name: name[4] || '', showName: name[0] === '1', showNum: nm[0] === '1', type: ELEC[f[2]],
      });
    });
    return pins;
  }

  function buildSym(ds) {
    const head = ds.head;
    const pins = parsePins(ds.shape);
    // начало координат символа выбираем так, чтобы выводы попали на целую сетку U
    const fr = v => ((Math.round((v - head.x) * 10) / 100) % 1 + 1) % 1;
    const best = arr => { const cnt = new Map(); arr.forEach(v => { const k = Math.round(v * 10) / 10 % 1; cnt.set(k, (cnt.get(k) || 0) + 1); }); return [...cnt].sort((a, b) => b[1] - a[1])[0][0]; };
    const fx = pins.length ? best(pins.map(p => fr(p.x))) : 0;
    const fy = pins.length ? best(pins.map(p => ((Math.round((p.y - head.y) * 10) / 100) % 1 + 1) % 1)) : 0;
    const ox = head.x + fx * 10, oy = head.y + fy * 10;
    const U = (x, y) => [R3((x - ox) / 10), R3((y - oy) / 10)];

    const gfx = [];
    ds.shape.forEach(s => {
      const f = s.split('~');
      const t = f[0];
      if (t === 'R') {
        const [x1, y1] = U(+f[1], +f[2]), w = +f[5] / 10, h = +f[6] / 10;
        gfx.push({ t: 'rect', x1, y1, x2: R3(x1 + w), y2: R3(y1 + h), fill: f[10] && f[10] !== 'none' ? 'body' : 'none' });
      } else if (t === 'E' || t === 'C') {
        const [cx, cy] = U(+f[1], +f[2]);
        const rx = +f[3] / 10, ry = (t === 'E' ? +f[4] : +f[3]) / 10;
        if (Math.abs(rx - ry) < 0.01) gfx.push({ t: 'circle', cx, cy, r: R3(rx), fill: 'none' });
        else { const pts = []; for (let k = 0; k <= 24; k++) { const a = k / 24 * 2 * Math.PI; pts.push([R3(cx + rx * Math.cos(a)), R3(cy + ry * Math.sin(a))]); } gfx.push({ t: 'line', pts }); }
      } else if (t === 'PL' || t === 'PG') {
        const nums = f[1].trim().split(/[\s,]+/).map(Number);
        const pts = [];
        for (let k = 0; k + 1 < nums.length; k += 2) pts.push(U(nums[k], nums[k + 1]));
        if (pts.length > 1) gfx.push(t === 'PG' && f[5] && f[5] !== 'none' ? { t: 'poly', pts } : { t: 'line', pts: t === 'PG' ? pts.concat([pts[0]]) : pts });
      } else if (t === 'A' || t === 'PT') {
        pathToPolylines(f[1]).forEach(l => gfx.push({ t: 'line', pts: l.map(p => U(p[0], p[1])) }));
      }
    });

    const DIR = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'R' : 'L') : (dy >= 0 ? 'D' : 'U');
    const spins = {};
    let showNames = false, showNums = false;
    pins.forEach(p => {
      const [ux, uy] = U(p.x, p.y);
      const sp = { x: Math.round(ux), y: Math.round(uy), dir: DIR(p.dx, p.dy), len: R3(Math.max(0.3, Math.hypot(p.dx, p.dy) / 10)), name: p.name, ee: [p.x, p.y] };
      if (p.type) sp.type = p.type;
      // вывод не на сетке — подпорка проводом при вставке в EasyEDA
      if (Math.abs(sp.x - ux) > 0.01 || Math.abs(sp.y - uy) > 0.01) sp.off = true;
      if (p.showName && p.name && p.name !== p.num) showNames = true;
      if (p.showNum) showNums = true;
      if (!spins[p.num]) spins[p.num] = sp;
    });
    const sym = { gfx, pins: spins, showNames, showNums: showNums && pins.length > 2, ic: pins.length > 4 };
    const bb = AK.symBBox(sym);
    sym.ref = [R3((bb.x1 + bb.x2) / 2), R3(bb.y1 - 0.6), 'middle'];
    sym.val = [R3((bb.x1 + bb.x2) / 2), R3(bb.y2 + 0.9), 'middle'];
    sym.bbox = AK.symBBox(sym);
    return { sym, origin: [ox, oy] };
  }

  // ---------- вид на макетной плате ----------
  function footprintPads(pk) {
    if (!pk || !pk.shape) return [];
    return pk.shape.filter(s => s.startsWith('PAD~')).map(s => {
      const f = s.split('~');
      return { num: f[8], x: +f[2], y: +f[3], tht: +f[9] > 0 };
    });
  }

  // посадочное место EasyEDA → формат AK.FOOTPRINTS (мм от начала координат посадочного места)
  function fpFromPackage(pk) {
    if (!pk || !pk.shape || !pk.head) return null;
    const ox = +pk.head.x || 0, oy = +pk.head.y || 0, MM = 0.254;
    const r3 = v => Math.round(v * 1000) / 1000;
    const X = v => r3((v - ox) * MM), Y = v => r3((v - oy) * MM);
    const out = { pads: [], silk: [], fab: [], crt: null };
    pk.shape.forEach(s => {
      const f = s.split('~');
      if (f[0] === 'PAD') {
        const pts = (f[10] || '').trim().split(/\s+/).map(Number).filter(v => !isNaN(v));
        let w = +f[4] * MM, h = +f[5] * MM, rot = +f[11] || 0, sh = { ELLIPSE: 'circle', OVAL: 'oval', RECT: 'rect', POLYGON: 'rect' }[f[1]] || 'rect';
        // у прямоугольной и многоугольной площадки размеры и поворот — по углам контура
        if ((f[1] === 'RECT' || f[1] === 'POLYGON') && pts.length >= 8) {
          const P = []; for (let i = 0; i + 1 < pts.length; i += 2) P.push([pts[i], pts[i + 1]]);
          if (f[1] === 'RECT') {
            w = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) * MM;
            h = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]) * MM;
            rot = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]) * 180 / Math.PI;
          } else {
            const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
            w = (Math.max(...xs) - Math.min(...xs)) * MM; h = (Math.max(...ys) - Math.min(...ys)) * MM; rot = 0;
          }
        }
        if (sh === 'circle' && Math.abs(w - h) > 0.01) sh = 'oval';
        const holeR = +f[9] || 0, slot = +f[13] || 0;
        const p = { n: f[8], k: holeR > 0 ? 'thru_hole' : 'smd', sh, x: X(+f[2]), y: Y(+f[3]), w: r3(w), h: r3(h), l: f[6] === '11' ? '*' : f[6] === '2' ? 'B' : 'F' };
        if (Math.abs(rot) > 0.01) p.r = r3(((rot % 360) + 360) % 360);
        if (holeR > 0) p.d = slot > 0 ? (w >= h ? [r3((holeR * 2 + slot) * MM), r3(holeR * 2 * MM)] : [r3(holeR * 2 * MM), r3((holeR * 2 + slot) * MM)]) : r3(holeR * 2 * MM);
        if (holeR > 0 && f[15] === 'N') p.k = 'np_thru_hole';
        out.pads.push(p);
      } else if (f[0] === 'HOLE') {
        const d = r3(+f[3] * 2 * MM);
        out.pads.push({ n: '', k: 'np_thru_hole', sh: 'circle', x: X(+f[1]), y: Y(+f[2]), w: d, h: d, d, l: '*' });
      } else if (f[0] === 'TRACK' && f[2] === '3') {
        const v = f[4].trim().split(/\s+/).map(Number), p = [];
        for (let i = 0; i + 1 < v.length; i += 2) p.push([X(v[i]), Y(v[i + 1])]);
        if (p.length > 1) out.silk.push({ w: r3(+f[1] * MM), p });
      } else if (f[0] === 'CIRCLE' && f[5] === '3') {
        const cx = +f[1], cy = +f[2], r = +f[3], p = [];
        for (let k = 0; k <= 24; k++) p.push([X(cx + r * Math.cos(k * Math.PI / 12)), Y(cy + r * Math.sin(k * Math.PI / 12))]);
        out.silk.push({ w: r3(+f[4] * MM), p });
      } else if (f[0] === 'ARC' && f[2] === '3') {
        pathToPolylines(f[4]).forEach(line => { if (line.length > 1) out.silk.push({ w: r3(+f[1] * MM), p: line.map(([x, y]) => [X(x), Y(y)]) }); });
      }
    });
    if (!out.pads.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    out.pads.forEach(p => { const r = Math.max(p.w, p.h) / 2; add(p.x - r, p.y - r); add(p.x + r, p.y + r); });
    out.silk.forEach(l => l.p.forEach(([x, y]) => add(x, y)));
    out.crt = [r3(x1 - 0.25), r3(y1 - 0.25), r3(x2 + 0.25), r3(y2 + 0.25)];
    return out;
  }

  // раскладка выводов: по посадочному месту, если оно выводное и с шагом 0.1", иначе — запасная
  function pinLayout(nums, pads) {
    const tht = pads.filter(p => p.tht && nums.includes(p.num));
    const uniq = new Map();
    tht.forEach(p => { if (!uniq.has(p.num)) uniq.set(p.num, p); });
    if (uniq.size === nums.length && nums.length) {
      const list = [...uniq.values()], p0 = list[0];
      const pos = list.map(p => [Math.round((p.x - p0.x) / 10) * 10, Math.round((p.y - p0.y) / 10) * 10, p]);
      const onGrid = list.every(p => Math.abs((p.x - p0.x) / 10 - Math.round((p.x - p0.x) / 10)) < 0.2 && Math.abs((p.y - p0.y) / 10 - Math.round((p.y - p0.y) / 10)) < 0.2);
      const distinct = new Set(pos.map(q => q[0] + ',' + q[1])).size === pos.length;
      if (onGrid && distinct) {
        const xs = pos.map(q => q[0]), ys = pos.map(q => q[1]);
        const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 20) * 10, cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 20) * 10;
        const pins = {};
        pos.forEach(([x, y, p]) => { pins[p.num] = [x - cx, y - cy]; });
        return { pins, fromFootprint: true };
      }
    }
    // запасной вариант (SMD, шаг 1.27 мм и т.п.): выводы с шагом 0.1", как у переходной платы
    const n = nums.length, pins = {};
    if (n === 1) pins[nums[0]] = [0, 0];
    else if (n === 2) { pins[nums[0]] = [-20, 0]; pins[nums[1]] = [20, 0]; }
    else if (n === 3) nums.forEach((k, i) => { pins[k] = [(i - 1) * 10, 20]; });
    else {
      const half = Math.ceil(n / 2), x0 = -Math.floor((half - 1) / 2) * 10;
      nums.forEach((k, i) => { pins[k] = i < half ? [x0 + i * 10, 15] : [x0 + (n - 1 - i) * 10, -15]; });
    }
    return { pins, fromFootprint: false };
  }

  function kindOf(part, prefix, n) {
    const t = (part.title + ' ' + (part.tags || []).join(' ') + ' ' + ((part.dataStr.head.c_para || {}).package || '')).toLowerCase();
    if (n === 2 && /led/.test(t) && !/driver|strip/.test(t)) return 'led';
    if (n === 2 && prefix === 'R') return 'resistor';
    if (n === 2 && prefix === 'C') return /cp|elec|radial|bd\d|cap-th_bd/i.test(t) ? 'elec' : 'cap';
    if (n === 2 && prefix === 'D') return 'diode';
    if (/^(rv|vr)$/i.test(prefix) || /potentiometer|res-adj/.test(t)) return 'pot';
    if (prefix === 'Q' && n === 3) return 'transistor';
    return 'generic';
  }

  function makeVisual(part, prefix, sym) {
    const nums = Object.keys(sym.pins).sort((a, b) => (+a - +b) || a.localeCompare(b));
    const lay = pinLayout(nums, footprintPads(part.packageDetail && part.packageDetail.dataStr));
    const pins = lay.pins;
    const pts = Object.values(pins);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const kind = kindOf(part, prefix, nums.length);
    const D = AK.DRAW, esc = AK.util.esc;
    const label = String(part.title).slice(0, 14);
    const legs = (y2) => pts.map(([x, y]) => D.leg(x, y, x, y2)).join('');
    let box, hit, draw;
    const horiz = maxY - minY < 1 && nums.length === 2; // два вывода в ряд
    const span = maxX - minX;

    if (horiz && span >= 30 && (kind === 'resistor' || kind === 'diode' || kind === 'generic')) {
      // аксиальный корпус между выводами
      const bw = Math.min(36, span - 12), y = minY;
      box = [minX, y - 8, span, 16]; hit = [minX + (span - bw) / 2, y - 7, bw, 14];
      draw = c => {
        const x1 = minX + (span - bw) / 2, x2 = x1 + bw;
        let s = D.leg(minX, y, x1 + 2, y) + D.leg(x2 - 2, y, maxX, y);
        if (kind === 'resistor') {
          const b = D.resistorBands(c.value);
          s += `<rect x="${x1}" y="${y - 6.5}" width="${bw}" height="13" rx="6" fill="#e3c48f" stroke="#a8885a"/>`;
          [0.2, 0.36, 0.52].forEach((f, i) => { s += `<rect x="${x1 + bw * f}" y="${y - 6.5}" width="3.5" height="13" fill="${b[i]}"/>`; });
          s += `<rect x="${x1 + bw * 0.78}" y="${y - 6.5}" width="3" height="13" fill="#c9a227"/>`;
        } else if (kind === 'diode') {
          s += `<rect x="${x1}" y="${y - 5}" width="${bw}" height="10" rx="2" fill="#222"/><rect x="${x2 - 7}" y="${y - 5}" width="3.5" height="10" fill="#cfcfcf"/>`;
        } else {
          s += `<rect x="${x1}" y="${y - 6}" width="${bw}" height="12" rx="2" fill="#37474f"/>` + D.txt((x1 + x2) / 2, y, label, 4, '#fff');
        }
        return s;
      };
    } else if (horiz && (kind === 'led' || kind === 'cap' || kind === 'elec' || kind === 'generic' || kind === 'resistor' || kind === 'diode')) {
      // радиальный корпус над выводами
      const cx = (minX + maxX) / 2, y = minY, r = Math.max(11, span / 2 + 3);
      box = [cx - r - 2, y - 47, 2 * r + 4, 47]; hit = [cx - r, y - 47, 2 * r, 30];
      draw = c => {
        let s = D.leg(minX, y, cx - 5, y - 18) + D.leg(maxX, y, cx + 5, y - 18);
        if (kind === 'led') {
          const col = D.LED_COLORS[(/(red|green|blue|yellow|white|orange)/.exec((part.title + ' ' + (c.value || '')).toLowerCase()) || [])[1] || 'red'];
          s += `<rect x="${cx - 13}" y="${y - 22}" width="26" height="5" rx="2" fill="${col}" stroke="rgba(0,0,0,.35)"/>` +
            `<path d="M ${cx - 11} ${y - 22} L ${cx - 11} ${y - 34} A 11 11 0 0 1 ${cx + 11} ${y - 34} L ${cx + 11} ${y - 22} Z" fill="${col}" fill-opacity=".92" stroke="rgba(0,0,0,.35)"/>`;
        } else if (kind === 'elec') {
          s += `<rect x="${cx - 13}" y="${y - 47}" width="26" height="30" rx="4" fill="#1f3f8a" stroke="#122656"/><rect x="${cx + 5}" y="${y - 47}" width="6" height="30" fill="#c9d3e6"/>`;
        } else {
          s += `<ellipse cx="${cx}" cy="${y - 26}" rx="${r}" ry="10" fill="${kind === 'cap' ? '#f0a43a' : '#455a64'}" stroke="rgba(0,0,0,.35)"/>` + D.txt(cx, y - 26, label, 4, kind === 'cap' ? '#5a3500' : '#fff');
        }
        return s;
      };
    } else if (maxY - minY < 1) {
      // один ряд выводов (транзистор, потенциометр, разъём, модуль)
      const y = minY, x1 = minX - 7, w = span + 14, col = kind === 'transistor' ? '#262626' : kind === 'pot' ? '#1565c0' : '#2f3a44';
      box = [x1, y - 34, w, 34]; hit = [x1, y - 34, w, 26];
      draw = () => legs(y - 10) + `<rect x="${x1}" y="${y - 34}" width="${w}" height="24" rx="${kind === 'transistor' ? 10 : 3}" fill="${col}"/>` +
        (kind === 'pot' ? `<circle cx="${(minX + maxX) / 2}" cy="${y - 22}" r="8" fill="#eceff1"/>` : D.txt((minX + maxX) / 2, y - 22, label, 4.5, '#ddd'));
    } else {
      // корпус между рядами выводов (DIP, модуль на переходной плате)
      const x1 = minX - 7, w = span + 14, h = maxY - minY;
      const body = lay.fromFootprint ? '#2b2b2b' : '#1d6fb8';
      box = [x1, minY - 2, w, h + 4]; hit = [x1, minY + 4, w, h - 8];
      draw = () => {
        let s = pts.map(([x, y]) => `<rect x="${x - 2}" y="${Math.min(y, (minY + maxY) / 2)}" width="4" height="${Math.abs(y - (minY + maxY) / 2)}" fill="#b9bec4"/>`).join('');
        s += `<rect x="${x1}" y="${minY + 4}" width="${w}" height="${h - 8}" rx="2" fill="${body}" stroke="#000"/>`;
        s += `<circle cx="${x1 + 5}" cy="${maxY - 9}" r="1.8" fill="#666"/>`;
        s += D.txt((minX + maxX) / 2, (minY + maxY) / 2, label, Math.min(7, Math.max(4, (w - 6) / label.length * 1.6)), '#ddd', 'font-weight="600"');
        return s;
      };
    }
    return { box, hit, pins, draw, fromFootprint: lay.fromFootprint };
  }

  // ---------- определение компонента ----------
  function defFromPart(part) {
    const ds = part.dataStr, cp = ds.head.c_para || {};
    const prefix = String(cp.pre || 'U?').replace(/\?$/, '') || 'U';
    const { sym, origin } = buildSym(ds);
    const type = 'ee_' + part.uuid;
    const value = cp.Value || cp['Manufacturer Part'] || cp.name || part.title;
    const d = {
      type, name: part.title, prefix, cat: 'Из библиотеки EasyEDA', value, kicadName: (part.title + (cp['Supplier Part'] ? '_' + cp['Supplier Part'] : '')).replace(/[^\w.+-]+/g, '_'),
      footprint: '', eePackage: cp.package || '', lcsc: (part.lcsc && part.lcsc.number) || cp['Supplier Part'] || '',
      sym, ee: { uuid: part.uuid, origin, head: ds.head, shapes: ds.shape, fp: fpFromPackage(part.packageDetail && part.packageDetail.dataStr), fpName: (part.packageDetail && part.packageDetail.title) || cp.package || '' },
      fromLibrary: true,
    };
    d.visual = makeVisual(part, prefix, sym);
    return d;
  }

  // компоненты библиотеки, сохранённые в проекте, → AK.LIB
  function register(project) {
    const parts = project && project.eeParts;
    if (!parts) return;
    Object.values(parts).forEach(part => {
      const t = 'ee_' + part.uuid;
      if (!AK.LIB[t]) {
        try { AK.LIB[t] = defFromPart(part); } catch (e) { console.warn('EasyEDA part', part.title, e); }
      }
    });
  }

  // только то, что нужно для работы (символ и посадочное место)
  function slim(r) {
    return {
      uuid: r.uuid, title: r.title, tags: r.tags, lcsc: r.lcsc ? { number: r.lcsc.number } : null,
      dataStr: { head: r.dataStr.head, shape: r.dataStr.shape },
      packageDetail: r.packageDetail ? { uuid: r.packageDetail.uuid, title: r.packageDetail.title, dataStr: { head: r.packageDetail.dataStr.head, shape: r.packageDetail.dataStr.shape } } : null,
    };
  }

  // ---------- сеть ----------
  async function search(wd) {
    const body = new URLSearchParams({ type: '3', 'doctype[]': '2', uid: LCSC_UID, returnListStyle: 'classifyarr', wd, version: VER });
    const r = await (await fetch(API + '/api/components/search', { method: 'POST', body, credentials: 'include' })).json();
    if (!r.success) throw new Error(r.message || 'search failed');
    const L = r.result.lists || {};
    const seen = new Set();
    return [...(L.lcsc || []), ...(L.easyeda || []), ...(L.user || [])].filter(x => x.docType === 2 && !seen.has(x.uuid) && seen.add(x.uuid)).slice(0, 60).map(x => {
      const cp = (x.dataStr && x.dataStr.head && x.dataStr.head.c_para) || {};
      return { uuid: x.uuid, title: x.title, package: cp.package || '', lcsc: cp['Supplier Part'] || '', thumb: x.thumb ? (/^\/\//.test(x.thumb) ? 'https:' + x.thumb : x.thumb) : '', desc: x.description || '' };
    });
  }

  async function fetchPart(uuidOrLcsc) {
    const url = /^C\d+$/i.test(uuidOrLcsc)
      ? `${API}/api/products/${uuidOrLcsc.toUpperCase()}/components?version=${VER}`
      : `${API}/api/components/${uuidOrLcsc}?version=${VER}&uuid=${uuidOrLcsc}`;
    const r = await (await fetch(url, { credentials: 'include' })).json();
    if (!r.success || !r.result || !r.result.dataStr) throw new Error(r.message || 'component not found');
    return slim(r.result);
  }

  // доступна ли библиотека (только внутри EasyEDA: сервер не разрешает запросы с других сайтов)
  const available = () => {
    if (typeof location === 'undefined') return false;
    let host = location.hostname;
    try { host = host || window.top.location.hostname; } catch (e) { /* другой источник */ }
    return /(^|\.)easyeda\.com$/.test(host || '');
  };

  return { search, fetchPart, defFromPart, register, slim, pathToPolylines, fpFromPackage, available, ATTRIBUTION: 'JLCEDA/EasyEDA Official Library · https://lceda.cn/ · https://easyeda.com' };
})();
