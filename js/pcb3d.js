// Вкладка «3D»: объёмный вид печатной платы с деталями (canvas 2D, алгоритм художника).
// Плата — контур, вытянутый на 1.6 мм, с маской, площадками, отверстиями и шелкографией;
// детали — простые модели по посадочному месту (резисторы с цветными полосками, DIP, WS2812B, кнопки, USB-C…).
// Координаты платы — мм, ось Y вниз, z — вверх от поверхности платы.
window.AK = window.AK || {};

AK.Pcb3D = (function () {
  const TH = 1.6;                                         // толщина платы
  const PAD = '#cfd2d6', HOLE = '#141414', SILK = '#f4f4f4';
  // цвета полосок резистора: 0…9, затем множители 0.1 (золото) и 0.01 (серебро)
  const BAND = ['#1a1a1a', '#7a4a1e', '#d0281e', '#f07c12', '#f2d214', '#2e9a3a', '#2a56c8', '#8a3ec0', '#8a8a8a', '#f4f4f4'];
  const GOLD = '#c9a43a', SILVER = '#c0c4c8';
  const LED_COLORS = { red: '#ff3b2f', green: '#38d14a', blue: '#3a7bff', yellow: '#ffd21f', white: '#f4f6ff', orange: '#ff8a1f' };

  const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const shade = (h, k) => { const [r, g, b] = rgb(h); const f = v => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(r)},${f(g)},${f(b)})`; };

  // полоски резистора по номиналу (4 полоски: две цифры, множитель, допуск 5%)
  function resistorBands(value) {
    const v = AK.util.parseValue(value);
    if (!isFinite(v) || v <= 0) return [];
    let e = Math.floor(Math.log10(v)) - 1, d = Math.round(v / Math.pow(10, e));
    if (d >= 100) { d = Math.round(d / 10); e++; }
    const m = e >= 0 ? BAND[e] || BAND[9] : e === -1 ? GOLD : SILVER;
    return [BAND[Math.floor(d / 10)], BAND[d % 10], m, GOLD];
  }

  // ---------------- построение модели ----------------
  // грани собираются в правой системе координат: X = x, Y = −y, Z = z
  class Scene {
    constructor() { this.faces = []; this.lines = []; this.flat = []; this.texts = []; }
    // грань; c — точка внутри тела: нормаль разворачивается наружу
    face(pts, color, c) {
      const P = pts.map(([x, y, z]) => [x, -y, z]);
      let n = normal(P);
      if (c) {
        const m = mean(P), C = [c[0], -c[1], c[2]];
        if ((m[0] - C[0]) * n[0] + (m[1] - C[1]) * n[1] + (m[2] - C[2]) * n[2] < 0) { P.reverse(); n = n.map(v => -v); }
      }
      this.faces.push({ P, n, color });
    }
    line(pts, color, w) { this.lines.push({ P: pts.map(([x, y, z]) => [x, -y, z]), color, w }); }
    // плоская фигура на поверхности платы (площадки, шелкография) — рисуется сразу после платы
    flatPoly(pts, color, z) { this.flat.push({ P: pts.map(([x, y]) => [x, -y, z || 0.01]), color }); }
    flatLine(pts, color, w) { this.flat.push({ P: pts.map(([x, y]) => [x, -y, 0.02]), color, w, open: true }); }

    // прямоугольный брусок: центр (x, y), основание на высоте z0, размеры w × d × h, поворот rot° по часовой
    box(x, y, z0, w, d, h, rot, color, colors) {
      const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
      const p = (u, v, z) => [x + u * c - v * s, y + u * s + v * c, z];
      const u = w / 2, v = d / 2, z1 = z0 + h, ctr = [x, y, z0 + h / 2];
      const C = [[-u, -v], [u, -v], [u, v], [-u, v]];
      const col = k => (colors && colors[k]) || color;
      this.face(C.map(([a, b]) => p(a, b, z1)), col('top'), ctr);
      this.face(C.map(([a, b]) => p(a, b, z0)), col('bottom'), ctr);
      const side = ['n', 'e', 's', 'w'];
      for (let i = 0; i < 4; i++) {
        const [a1, b1] = C[i], [a2, b2] = C[(i + 1) % 4];
        this.face([p(a1, b1, z0), p(a2, b2, z0), p(a2, b2, z1), p(a1, b1, z1)], col(side[i]), ctr);
      }
    }
    // вертикальный цилиндр
    cylV(x, y, z0, r, h, color, top, n) {
      n = n || 18;
      const ring = z => Array.from({ length: n }, (_, k) => [x + r * Math.cos(2 * Math.PI * k / n), y + r * Math.sin(2 * Math.PI * k / n), z]);
      const a = ring(z0), b = ring(z0 + h), ctr = [x, y, z0 + h / 2];
      for (let k = 0; k < n; k++) this.face([a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]], color, ctr);
      this.face(b, top || color, ctr);
    }
    // купол (полусфера) над z0
    dome(x, y, z0, r, color, n) {
      n = n || 14;
      const st = 4;
      for (let j = 0; j < st; j++) {
        const t0 = j / st * Math.PI / 2, t1 = (j + 1) / st * Math.PI / 2;
        const r0 = r * Math.cos(t0), r1 = r * Math.cos(t1), h0 = r * Math.sin(t0), h1 = r * Math.sin(t1);
        for (let k = 0; k < n; k++) {
          const a0 = 2 * Math.PI * k / n, a1 = 2 * Math.PI * (k + 1) / n;
          const q = [[x + r0 * Math.cos(a0), y + r0 * Math.sin(a0), z0 + h0], [x + r0 * Math.cos(a1), y + r0 * Math.sin(a1), z0 + h0],
            [x + r1 * Math.cos(a1), y + r1 * Math.sin(a1), z0 + h1], [x + r1 * Math.cos(a0), y + r1 * Math.sin(a0), z0 + h1]];
          if (j === st - 1) q.pop();
          this.face(q, color, [x, y, z0]);
        }
      }
    }
    // горизонтальный цилиндр от (x1, y1) до (x2, y2) на высоте оси z; bands — [от, до, цвет] в долях длины
    cylH(x1, y1, x2, y2, z, r, color, bands, n) {
      n = n || 14;
      const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, vx = -uy, vy = ux;
      const ring = t => Array.from({ length: n }, (_, k) => {
        const a = 2 * Math.PI * k / n, cr = r * Math.cos(a), sr = r * Math.sin(a);
        return [x1 + ux * t * L + vx * cr, y1 + uy * t * L + vy * cr, z + sr];
      });
      const cuts = [0, 1];
      (bands || []).forEach(([a, b]) => cuts.push(a, b));
      const ts = [...new Set(cuts)].sort((a, b) => a - b);
      const ctrAt = t => [x1 + ux * t * L, y1 + uy * t * L, z];
      for (let i = 0; i + 1 < ts.length; i++) {
        const t0 = ts[i], t1 = ts[i + 1], tm = (t0 + t1) / 2;
        const band = (bands || []).find(([a, b]) => tm > a && tm < b);
        const A = ring(t0), B = ring(t1), col = band ? band[2] : color;
        for (let k = 0; k < n; k++) this.face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], col, ctrAt(tm));
      }
      this.face(ring(0), color, ctrAt(0.5));
      this.face(ring(1), color, ctrAt(0.5));
    }
  }
  function normal(P) {
    const [a, b, c] = [P[0], P[1], P[2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    return n.map(x => x / l);
  }
  const mean = P => [0, 1, 2].map(i => P.reduce((s, p) => s + p[i], 0) / P.length);

  // габарит корпуса в координатах посадочного места: по слою Fab, иначе по Courtyard
  function body(fp) {
    const pts = [].concat(...(fp.fab || []).map(l => l.p));
    if (pts.length > 1) {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    return fp.crt;
  }

  // модель детали
  function partModel(S, c, part, fp) {
    const d = AK.LIB[c.type], name = AK.PCB.fpName(c);
    const R = part.rot || 0;
    const T = (x, y) => { const [rx, ry] = AK.PCB.rot(x, y, R); return [part.x + rx, part.y + ry]; };
    const pads = fp.pads.filter(p => p.k !== 'np_thru_hole');
    const padBy = n => pads.find(p => p.n === n);
    const [bx1, by1, bx2, by2] = body(fp);
    const bc = T((bx1 + bx2) / 2, (by1 + by2) / 2), bw = bx2 - bx1, bh = by2 - by1;
    const num = (re, def) => { const m = re.exec(name); return m ? +m[1] : def; };
    const lead = (from, to, zTop) => {
      const a = T(from.x, from.y), b = T(to[0], to[1]);
      S.line([[a[0], a[1], 0], [a[0], a[1], zTop], [b[0], b[1], zTop]], SILVER, 0.5);
    };

    // осевые детали, лежащие на плате: резистор, дроссель, диод
    if (/Axial.*Horizontal|D_DO-(35|41)/.test(name) && padBy('1') && padBy('2')) {
      const p1 = padBy('1'), p2 = padBy('2');
      const diode = /D_DO/.test(name), do41 = /DO-41/.test(name);
      const L = num(/_L([\d.]+)mm/, diode ? (do41 ? 5.2 : 4) : 6.3), D = num(/_D([\d.]+)mm/, do41 ? 2.7 : diode ? 1.9 : 2.5);
      const r = D / 2, z = r + 0.4;
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y), ux = (p2.x - p1.x) / len, uy = (p2.y - p1.y) / len;
      const m = [(p1.x + p2.x) / 2, (p1.y + p2.y) / 2];
      const e1 = [m[0] - ux * L / 2, m[1] - uy * L / 2], e2 = [m[0] + ux * L / 2, m[1] + uy * L / 2];
      lead(p1, e1, z); lead(p2, e2, z);
      const A = T(...e1), B = T(...e2);
      let color = '#d8c595', bands = [];
      if (diode) {
        color = do41 ? '#262626' : '#d4552c';
        bands = [[0.1, 0.22, do41 ? '#b8b8b8' : '#1a1a1a']];          // катод — площадка 1
      } else if (c.type === 'inductor') color = '#3d7d55';
      else bands = resistorBands(c.value || d.value).map((col, i) => i < 3 ? [0.16 + i * 0.13, 0.25 + i * 0.13, col] : [0.74, 0.84, col]);
      S.cylH(A[0], A[1], B[0], B[1], z, r, color, bands);
      return;
    }
    // стоячий резистор
    if (/Axial.*Vertical/.test(name) && padBy('1') && padBy('2')) {
      const p1 = padBy('1'), p2 = padBy('2'), a = T(p1.x, p1.y), b = T(p2.x, p2.y);
      const L = num(/_L([\d.]+)mm/, 3.6), r = num(/_D([\d.]+)mm/, 1.6) / 2;
      S.cylV(a[0], a[1], 0.5, r, L, '#d8c595');
      S.line([[b[0], b[1], 0], [b[0], b[1], L + 1.2], [a[0], a[1], L + 1.2], [a[0], a[1], L + 0.5]], SILVER, 0.5);
      return;
    }
    // микросхема в DIP-корпусе
    if (/DIP-(\d+)/.test(name)) {
      const xs = pads.map(p => p.x), ys = pads.map(p => p.y);
      const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
      const W = x2 - x1 - 1.27, Lb = y2 - y1 + 2.0, H = 3.3, z0 = 0.6;
      const ctr = T((x1 + x2) / 2, (y1 + y2) / 2);
      pads.forEach(p => {
        const sx = p.x < (x1 + x2) / 2 ? 1 : -1;
        const a = T(p.x, p.y), b = T(p.x + sx * 0.6, p.y);
        S.line([[a[0], a[1], 0], [a[0], a[1], z0 + 1.2], [b[0], b[1], z0 + 1.6]], SILVER, 0.55);
      });
      S.box(ctr[0], ctr[1], z0, W, Lb, H, R, '#1c1c1e');
      // выемка у первого вывода
      const nm = T((x1 + x2) / 2, y1 - 1.0 + 0.4);
      S.cylV(nm[0], nm[1], z0 + H, 0.7, 0.02, '#0c0c0c', '#0c0c0c', 12);
      const dot = T(x1 + 1.1, y1 + 0.3);
      S.cylV(dot[0], dot[1], z0 + H, 0.35, 0.02, '#2c2c2e', '#2c2c2e', 10);
      return;
    }
    // адресный светодиод WS2812B (5050)
    if (/WS2812B|PLCC4/.test(name)) {
      S.box(bc[0], bc[1], 0.05, bw, bh, 1.6, R, '#f3f3f1');
      S.cylV(bc[0], bc[1], 1.65, Math.min(bw, bh) * 0.36, 0.02, '#f6e9ea', '#f2e2e4', 20);
      const mk = T(bx1 + 0.6, by1 + 0.6);
      S.cylV(mk[0], mk[1], 1.65, 0.3, 0.02, '#c9c9c9', '#9a9a9a', 8);
      return;
    }
    // тактовая кнопка 6×6
    if (/SW_PUSH_6mm/.test(name)) {
      const xs = pads.map(p => p.x), ys = pads.map(p => p.y);
      const ctr = T((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
      const hgt = /H5mm/.test(name) ? 5 : 4.3;
      pads.forEach(p => { const a = T(p.x, p.y); S.line([[a[0], a[1], 0], [a[0], a[1], 1]], SILVER, 0.6); });
      S.box(ctr[0], ctr[1], 0.3, 6, 6, 3.1, R, '#2b2b2d');
      S.box(ctr[0], ctr[1], 3.4, 6, 6, 0.25, R, '#b9bcc0');
      S.cylV(ctr[0], ctr[1], 3.65, 1.75, hgt - 3.65, '#141414', '#1e1e1e');
      return;
    }
    // разъём USB-C
    if (/USB_C/.test(name)) {
      const H = 3.2;
      S.box(bc[0], bc[1], 0, bw, bh, H, R, '#c8ccd1', { top: '#d6d9dd' });
      // отверстие разъёма на переднем торце (сторона +y посадочного места)
      const f = T((bx1 + bx2) / 2, by2 + 0.02);
      S.box(f[0], f[1], 0.55, bw - 1.6, 0.05, H - 1.1, R, '#151515');
      return;
    }
    // светодиод 3/5 мм
    if (/LED_D([\d.]+)mm/.test(name)) {
      const D = num(/LED_D([\d.]+)mm/, 5), r = D / 2;
      const p1 = padBy('1'), p2 = padBy('2'), ctr = T((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      const col = LED_COLORS[(c.props && c.props.color) || 'red'] || LED_COLORS.red;
      S.cylV(ctr[0], ctr[1], 1, r + 0.4, 1, shade(col, 0.85), shade(col, 0.95));
      S.cylV(ctr[0], ctr[1], 2, r, D * 0.9, col);
      S.dome(ctr[0], ctr[1], 2 + D * 0.9, r, col);
      [p1, p2].forEach(p => { const a = T(p.x, p.y); S.line([[a[0], a[1], 0], [a[0], a[1], 1]], SILVER, 0.5); });
      return;
    }
    // электролитический конденсатор (выводной и SMD)
    if (/CP_Radial_D([\d.]+)mm|CP_Elec_(\d+)x/.test(name)) {
      const D = num(/CP_Radial_D([\d.]+)mm/, num(/CP_Elec_(\d+)x/, 5));
      const smd = /CP_Elec/.test(name);
      const ctr = smd ? bc : T((pads[0].x + pads[1].x) / 2, (pads[0].y + pads[1].y) / 2);
      if (smd) S.box(ctr[0], ctr[1], 0, D + 0.3, D + 0.3, 1, R, '#1c1c1c');
      S.cylV(ctr[0], ctr[1], smd ? 1 : 0.3, D / 2, smd ? 4.4 : D * 2.2, smd ? '#c3c7cc' : '#1d2a58', smd ? '#d2d5d9' : '#9ea4ab', 20);
      return;
    }
    // керамический конденсатор-диск
    if (/C_Disc_D([\d.]+)mm/.test(name)) {
      const D = num(/C_Disc_D([\d.]+)mm/, 5), W = num(/_W([\d.]+)mm/, 2.5);
      const p1 = pads[0], p2 = pads[1], ctr = T((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      const ang = R + Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
      [p1, p2].forEach(p => { const a = T(p.x, p.y); S.line([[a[0], a[1], 0], [a[0], a[1], 2]], SILVER, 0.5); });
      S.box(ctr[0], ctr[1], 1.5, D, W * 0.8, D, ang, '#c7772b');
      return;
    }
    // штыревой разъём
    if (/PinHeader/.test(name)) {
      pads.forEach(p => {
        const a = T(p.x, p.y);
        S.box(a[0], a[1], 0, 2.54, 2.54, 2.5, R, '#1c1c1e');
        S.box(a[0], a[1], 2.5, 0.64, 0.64, 6, R, '#d8b24a');
      });
      return;
    }
    // транзистор TO-92 и TO-220
    if (/TO-92/.test(name)) {
      pads.forEach(p => { const a = T(p.x, p.y); S.line([[a[0], a[1], 0], [a[0], a[1], 2.5]], SILVER, 0.45); });
      const ctr = T((pads[0].x + pads[2].x) / 2, (pads[0].y + pads[2].y) / 2 - 0.4);
      S.box(ctr[0], ctr[1], 2.5, 4.8, 3.7, 4.6, R, '#1c1c1e');
      return;
    }
    if (/TO-220/.test(name)) {
      const ctr = T((pads[0].x + pads[2].x) / 2, (pads[0].y + pads[2].y) / 2);
      pads.forEach(p => { const a = T(p.x, p.y); S.line([[a[0], a[1], 0], [a[0], a[1], 3.5]], SILVER, 0.7); });
      S.box(ctr[0], ctr[1], 3.5, 10, 4.5, 9, R, '#1c1c1e');
      const tab = T((pads[0].x + pads[2].x) / 2, (pads[0].y + pads[2].y) / 2 + 1.6);
      S.box(tab[0], tab[1], 3.5, 10, 1.3, 15.5, R, '#c0c4c8');
      return;
    }
    // подстроечный резистор 3386P
    if (/Potentiometer/.test(name)) {
      S.box(bc[0], bc[1], 0.3, bw, bh, 4.8, R, '#2457b8');
      S.cylV(bc[0], bc[1], 5.1, 1.6, 0.5, '#f2f2f2');
      return;
    }
    // зуммер, кварц, фоторезистор
    if (/Buzzer/.test(name)) { S.cylV(bc[0], bc[1], 0, Math.min(bw, bh) / 2, 9.5, '#1a1a1a', '#262626', 24); return; }
    if (/Crystal/.test(name)) { S.box(bc[0], bc[1], 0.3, bw, bh, 3.5, R, '#c6c9ce'); return; }
    if (/LDR/.test(name)) {
      pads.forEach(p => { const a = T(p.x, p.y); S.line([[a[0], a[1], 0], [a[0], a[1], 3]], SILVER, 0.45); });
      S.cylV(bc[0], bc[1], 3, 2.5, 1.8, '#e3b04b', '#d94b2b', 18);
      return;
    }
    // Arduino Nano на штырях
    if (/Arduino_Nano/.test(name)) {
      // плата модуля — по рядам выводов (на слое Fab есть ещё выступ разъёма USB)
      const xs = pads.map(p => p.x), ys = pads.map(p => p.y);
      const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
      const mc = T((x1 + x2) / 2, (y1 + y2) / 2);
      pads.forEach(p => { const a = T(p.x, p.y); S.box(a[0], a[1], 0, 2.5, 2.5, 8, R, '#1c1c1e'); });
      S.box(mc[0], mc[1], 8, x2 - x1 + 2.8, y2 - y1 + 7.6, 1.6, R, '#1d4fa5');
      S.box(mc[0], mc[1], 9.6, 7, 7, 1.2, R + 45, '#1c1c1e');
      const usb = T((x1 + x2) / 2, y2 + 2.4);
      S.box(usb[0], usb[1], 9.6, 7.6, 9, 4, R, '#c8ccd1');
      return;
    }
    // ползунковый переключатель
    if (/SW_Slide/.test(name)) {
      S.box(bc[0], bc[1], 0, bw, bh, 3.5, R, '#202022');
      const k = T((bx1 + bx2) / 2 - 1, (by1 + by2) / 2);
      S.box(k[0], k[1], 3.5, 1.5, 1.5, 2.5, R, '#c0c4c8');
      return;
    }
    // крепёжные отверстия и контакты — только площадки
    if (/MountingHole|TestPoint/.test(name)) return;
    // SMD: резисторы, конденсаторы, светодиоды, диоды
    if (/_(0805|0603|1206)_/.test(name) || /D_SMA|MiniMELF/.test(name)) {
      const W = bw || 2, Hh = bh || 1.25;
      const col = /^Resistor/.test(name) ? '#1c1c1e' : /^Capacitor/.test(name) ? '#c9a77a' : /^LED/.test(name) ? '#f2f2f0' : /MiniMELF/.test(name) ? '#d4552c' : '#1c1c1e';
      S.box(bc[0], bc[1], 0, W, Hh, /D_SMA/.test(name) ? 2.2 : 0.6, R, col);
      if (/^LED/.test(name)) S.box(bc[0], bc[1], 0.6, W * 0.5, Hh * 0.7, 0.05, R, LED_COLORS[(c.props && c.props.color) || 'red'] || LED_COLORS.red);
      return;
    }
    // остальное (в том числе детали из библиотеки EasyEDA) — корпус по габариту
    const smd = pads.every(p => p.k === 'smd');
    S.box(bc[0], bc[1], smd ? 0 : 0.5, Math.max(0.8, bw), Math.max(0.8, bh), smd ? 1.2 : 3, R, '#222224');
  }

  // площадка → плоский многоугольник
  function padShape(pp) {
    const p = pp.p, a = pp.a, out = [];
    const tr = (x, y) => { const [rx, ry] = AK.PCB.rot(x, y, a); return [pp.x + rx, pp.y + ry]; };
    if (p.sh === 'rect' || p.sh === 'roundrect' || p.sh === 'trapezoid' || p.sh === 'custom') {
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v]) => out.push(tr(u * p.w / 2, v * p.h / 2)));
    } else {
      // круг и овал (скруглённый прямоугольник)
      const r = Math.min(p.w, p.h) / 2, lx = (p.w - 2 * r) / 2, ly = (p.h - 2 * r) / 2;
      for (let k = 0; k < 24; k++) {
        const t = 2 * Math.PI * k / 24, cx = Math.cos(t), cy = Math.sin(t);
        out.push(tr(cx * r + Math.sign(cx) * lx, cy * r + Math.sign(cy) * ly));
      }
    }
    return out;
  }
  const circle = (x, y, r, n) => Array.from({ length: n || 16 }, (_, k) => [x + r * Math.cos(2 * Math.PI * k / (n || 16)), y + r * Math.sin(2 * Math.PI * k / (n || 16))]);

  function build(project, nl, opts) {
    const S = new Scene();
    const pcb = AK.PCB.ensure(project);
    const ol = AK.PCB.outline(project);
    const mask = (AK.PCB.COLORS[pcb.color] || AK.PCB.COLORS.green)[1];
    // плата: стороны и верх
    const ctr = ol.reduce((s, p) => [s[0] + p[0] / ol.length, s[1] + p[1] / ol.length], [0, 0]);
    // торец платы — та же маска, темнее
    const edge = '#' + rgb(mask).map(v => Math.round(v * 0.7).toString(16).padStart(2, '0')).join('');
    S.board = { top: ol.map(([x, y]) => [x, -y, 0]), color: mask, edge, sides: [] };
    let area = 0;
    ol.forEach((p, i) => { const q = ol[(i + 1) % ol.length]; area += p[0] * q[1] - q[0] * p[1]; });
    ol.forEach((p, i) => {
      const q = ol[(i + 1) % ol.length];
      // наружная нормаль ребра (в координатах платы, ось Y вниз)
      let nx = q[1] - p[1], ny = -(q[0] - p[0]);
      if (area < 0) { nx = -nx; ny = -ny; }
      const l = Math.hypot(nx, ny) || 1;
      S.board.sides.push({ P: [[p[0], -p[1], 0], [q[0], -q[1], 0], [q[0], -q[1], -TH], [p[0], -p[1], -TH]], n: [nx / l, -ny / l, 0] });
    });
    S.center = [ctr[0], ctr[1]];
    const xs = ol.map(p => p[0]), ys = ol.map(p => p[1]);
    S.size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 10);
    S.silk = pcb.color === 'white' ? '#222222' : SILK;
    // площадки и отверстия
    const all = AK.PCB.pads(project, nl);
    all.forEach(pp => {
      const p = pp.p;
      if (p.k !== 'np_thru_hole' && p.l !== 'B') S.flatPoly(padShape(pp), PAD);
      if (p.d) {
        const r = (Array.isArray(p.d) ? Math.min(...p.d) : p.d) / 2;
        S.flatPoly(circle(pp.x, pp.y, r, 14), HOLE, 0.015);
      }
    });
    // шелкография и обозначения
    project.components.forEach(c => {
      const part = pcb.parts[c.id], fp = AK.PCB.footprint(c);
      if (!part || !fp) return;
      const T = (x, y) => { const [rx, ry] = AK.PCB.rot(x, y, part.rot || 0); return [part.x + rx, part.y + ry]; };
      (fp.silk || []).forEach(l => S.flatLine(l.p.map(([x, y]) => T(x, y)), S.silk, Math.max(0.15, l.w)));
      const t = AK.PCB.refPos(c, part, fp);
      S.texts.push({ text: c.ref, x: t[0], y: t[1], rot: 0, size: 1 });
      if (!opts || opts.parts !== false) partModel(S, c, part, fp);
    });
    (pcb.texts || []).filter(t => !t.bottom).forEach(t => S.texts.push({ text: t.text, x: t.x, y: t.y, rot: t.rot || 0, size: t.size || 1.2 }));
    return S;
  }

  // ---------------- вид ----------------
  class View {
    constructor(canvas, app) {
      this.cv = canvas; this.app = app;
      this.yaw = 0; this.pitch = 55; this.scale = 1; this.pan = [0, 0];
      this.showParts = true;
      this.bind();
    }
    bind() {
      const cv = this.cv;
      let drag = null;
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey }; });
      cv.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (drag.pan) { this.pan[0] += dx; this.pan[1] += dy; } else {
          this.yaw = (this.yaw + dx * 0.4) % 360;
          this.pitch = Math.max(5, Math.min(90, this.pitch + dy * 0.3));
        }
        this.render();
      });
      cv.addEventListener('pointerup', () => { drag = null; });
      cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
      cv.addEventListener('dblclick', () => this.fit());
    }
    zoomBy(k) { this.scale = Math.max(0.2, Math.min(12, this.scale * k)); this.render(); }
    fit() { this.scale = 1; this.pan = [0, 0]; this.render(); }
    setView(yaw, pitch) { this.yaw = yaw; this.pitch = pitch; this.pan = [0, 0]; this.render(); }
    applyView() { this.render(); }

    render() {
      const cv = this.cv;
      if (cv.hidden) return;
      const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#dfe4ea'); bg.addColorStop(1, '#b9c1cb');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const P = this.app.project;
      if (!P.components.some(c => AK.PCB.footprint(c))) {
        g.fillStyle = '#56606b'; g.font = '15px Arial'; g.textAlign = 'center';
        g.fillText('Добавьте детали — здесь появится плата в 3D', W / 2, H / 2);
        return;
      }
      const S = build(P, this.app.netlist(), { parts: this.showParts });
      this.draw(g, S, W, H);
    }

    draw(g, S, W, H) {
      const yaw = this.yaw * Math.PI / 180, e = this.pitch * Math.PI / 180;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), ce = Math.cos(e), se = Math.sin(e);
      const [mx, my] = S.center;
      const base = Math.min(W, H) * 0.78 / S.size * this.scale, Dist = S.size * 3.2;
      const ox = W / 2 + this.pan[0], oy = H / 2 + this.pan[1];
      // мир (X, Y, Z) → экран; depth — к зрителю
      const proj = ([X, Y, Z]) => {
        const x = X - mx, y = Y + my;
        const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
        const up = y1 * se + Z * ce, depth = -y1 * ce + Z * se;
        const f = Dist / (Dist - depth);
        return [ox + x1 * base * f, oy - up * base * f, depth];
      };
      // направление на зрителя и свет (в мировых координатах)
      const view = [ce * sy, -ce * cy, se];
      const light = (() => { const l = [-0.35, 0.45, 0.82]; const n = Math.hypot(...l); return l.map(v => v / n); })();
      const lit = (n, col) => {
        const k = 0.58 + 0.42 * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
        return shade(col, k);
      };
      const poly = (pts, fill, stroke) => {
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        if (fill) { g.fillStyle = fill; g.fill(); }
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = 0.6; g.stroke(); }
      };
      // плата: нижняя сторона не видна (вид сверху), стороны — по глубине, затем верх
      S.board.sides
        .filter(s => s.n[0] * view[0] + s.n[1] * view[1] > -0.02)
        .map(s => ({ s, d: s.P.reduce((a, p) => a + proj(p)[2], 0) / 4 }))
        .sort((a, b) => a.d - b.d)
        .forEach(({ s }) => poly(s.P.map(proj), lit(s.n, S.board.edge)));
      poly(S.board.top.map(proj), lit([0, 0, 1], S.board.color));
      // площадки, отверстия, шелкография
      S.flat.forEach(f => {
        const pts = f.P.map(proj);
        if (f.open) {
          g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.strokeStyle = f.color; g.lineWidth = Math.max(0.6, f.w * base); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
        } else poly(pts, f.color === HOLE ? HOLE : lit([0, 0, 1], f.color));
      });
      // надписи — в плоскости платы
      g.fillStyle = S.silk; g.textAlign = 'center'; g.textBaseline = 'middle';
      S.texts.forEach(t => {
        const a = (t.rot || 0) * Math.PI / 180;
        const p0 = proj([t.x, -t.y, 0.02]), px = proj([t.x + Math.cos(a), -(t.y + Math.sin(a)), 0.02]), py = proj([t.x - Math.sin(a), -(t.y + Math.cos(a)), 0.02]);
        g.save();
        g.transform(px[0] - p0[0], px[1] - p0[1], py[0] - p0[0], py[1] - p0[1], p0[0], p0[1]);
        g.font = `${t.size}px Arial`;
        g.fillText(t.text, 0, 0);
        g.restore();
      });
      // детали: грани и выводы — по глубине (дальние сначала)
      const items = [];
      S.faces.forEach(f => {
        if (f.n[0] * view[0] + f.n[1] * view[1] + f.n[2] * view[2] < -0.05) return;  // задняя грань
        const pts = f.P.map(proj);
        items.push({ d: pts.reduce((a, p) => a + p[2], 0) / pts.length, pts, fill: lit(f.n, f.color) });
      });
      S.lines.forEach(l => {
        for (let i = 0; i + 1 < l.P.length; i++) {
          const a = proj(l.P[i]), b = proj(l.P[i + 1]);
          items.push({ d: (a[2] + b[2]) / 2, line: [a, b], color: l.color, w: l.w });
        }
      });
      items.sort((a, b) => a.d - b.d);
      g.lineJoin = 'round';
      items.forEach(it => {
        if (it.line) {
          g.beginPath(); g.moveTo(it.line[0][0], it.line[0][1]); g.lineTo(it.line[1][0], it.line[1][1]);
          g.strokeStyle = it.color; g.lineWidth = Math.max(1, it.w * base); g.lineCap = 'round'; g.stroke();
        } else {
          poly(it.pts, it.fill);
          g.strokeStyle = it.fill; g.lineWidth = 0.5; g.stroke();                         // без щелей между гранями
        }
      });
    }
  }

  return { View, build, resistorBands };
})();
