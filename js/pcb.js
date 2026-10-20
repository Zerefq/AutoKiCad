// Печатная плата: расположение деталей, контур, площадки с цепями, линии связей,
// экспорт в EasyEDA Standard (документ платы) и KiCad (.kicad_pcb).
// Единицы — мм, ось Y вниз. Поворот детали rot — градусы по часовой стрелке (как на экране).
window.AK = window.AK || {};

AK.PCB = (function () {
  const R3 = v => Math.round(v * 1000) / 1000;
  const rot = (x, y, deg) => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  };

  // Формы платы. heart — по фото платы-сердца (вырез сверху, скошенные бока, плоский низ под разъём)
  const HEART = [[6, 0], [15, 0], [22, 9], [29, 0], [38, 0], [44, 9], [44, 26], [26.5, 43.5], [17.5, 43.5], [0, 26], [0, 9]].map(([x, y]) => [x / 44, y / 43.5]);
  const SHAPES = { auto: 'По деталям (прямоугольник)', rect: 'Прямоугольник', heart: 'Сердце', circle: 'Круг', poly: 'Свой контур' };
  const COLORS = { green: ['Зелёная', '#1f6b3a'], purple: ['Фиолетовая', '#4a1a70'], black: ['Чёрная', '#1d1f22'], blue: ['Синяя', '#1a3f8a'], red: ['Красная', '#8a1a1a'], white: ['Белая', '#e9e9e4'] };

  // посадочное место детали (мм) или null
  function footprint(comp) {
    const d = AK.LIB[comp.type];
    if (!d || d.virtual) return null;
    if (d.ee && d.ee.fp) return d.ee.fp;
    const name = comp.fp || d.footprint;
    return (AK.FOOTPRINTS && AK.FOOTPRINTS[name]) || null;
  }
  const fpName = comp => { const d = AK.LIB[comp.type]; return comp.fp || d.footprint || (d.ee && d.ee.fpName) || d.eePackage || ''; };
  // площадка → вывод компонента (у USB-C несколько площадок на один вывод)
  function padPin(d, n) {
    if (d.padMap) return d.padMap[n] || null;
    return d.visual.pins[n] ? n : null;
  }

  function ensure(project) {
    if (!project.pcb) project.pcb = { shape: { type: 'auto' }, color: 'green', parts: {}, texts: [] };
    const pcb = project.pcb;
    pcb.parts = pcb.parts || {};
    pcb.texts = pcb.texts || [];
    // новым деталям — место справа от уже расставленных
    const comps = project.components.filter(c => footprint(c));
    let maxX = 0, cx = 0, cy = 0, rowH = 0;
    comps.forEach(c => { const p = pcb.parts[c.id]; if (p) maxX = Math.max(maxX, p.x + 6); });
    comps.forEach(c => {
      if (pcb.parts[c.id]) return;
      const fp = footprint(c);
      const [x1, y1, x2, y2] = fp.crt;
      const w = x2 - x1, h = y2 - y1;
      if (cx + w > 60) { cx = 0; cy += rowH + 2; rowH = 0; }
      pcb.parts[c.id] = { x: R3(maxX + cx - x1 + 3), y: R3(cy - y1 + 3), rot: 0 };
      cx += w + 2; rowH = Math.max(rowH, h);
    });
    Object.keys(pcb.parts).forEach(id => { if (!comps.some(c => c.id === id)) delete pcb.parts[id]; });
    return pcb;
  }

  // площадки всех деталей в координатах платы
  function pads(project, nl) {
    const pcb = ensure(project);
    const out = [];
    project.components.forEach(c => {
      const fp = footprint(c), part = pcb.parts[c.id];
      if (!fp || !part) return;
      const d = AK.LIB[c.type];
      fp.pads.forEach((p, i) => {
        const [dx, dy] = rot(p.x, p.y, part.rot || 0);
        const pin = p.k === 'np_thru_hole' ? null : padPin(d, p.n);
        const net = pin && nl ? nl.pinNet.get(c.id + ':' + pin) : null;
        out.push({ c, part, p, i, x: part.x + dx, y: part.y + dy, a: (part.rot || 0) + (p.r || 0), pin, net: net && net.drawn ? net.name : '' });
      });
    });
    return out;
  }

  // линии связей: минимальное остовное дерево площадок каждой цепи
  function ratsnest(padList) {
    const byNet = new Map();
    padList.forEach(p => { if (p.net) { if (!byNet.has(p.net)) byNet.set(p.net, []); byNet.get(p.net).push(p); } });
    const lines = [];
    byNet.forEach((ps, net) => {
      // площадки одного вывода детали (например, 4 ножки кнопки) уже соединены внутри детали — но связь нужна,
      // поэтому дерево строится по всем площадкам
      const inT = new Set([0]);
      while (inT.size < ps.length) {
        let best = null;
        inT.forEach(i => ps.forEach((q, j) => {
          if (inT.has(j)) return;
          const d = Math.hypot(ps[i].x - q.x, ps[i].y - q.y);
          if (!best || d < best.d) best = { i, j, d };
        }));
        inT.add(best.j);
        lines.push({ net, a: ps[best.i], b: ps[best.j] });
      }
    });
    return lines;
  }

  // контур платы — многоугольник (мм)
  function outline(project) {
    const pcb = ensure(project), sh = pcb.shape || { type: 'auto' };
    const W = +sh.w || 50, H = +sh.h || 40, ox = +sh.x || 0, oy = +sh.y || 0;
    if (sh.type === 'poly' && sh.pts && sh.pts.length > 2) return sh.pts.map(([x, y]) => [x, y]);
    if (sh.type === 'heart') return HEART.map(([x, y]) => [R3(ox + x * W), R3(oy + y * H)]);
    if (sh.type === 'circle') {
      const pts = [];
      for (let k = 0; k < 48; k++) pts.push([R3(ox + W / 2 + W / 2 * Math.cos(k * Math.PI / 24)), R3(oy + W / 2 + W / 2 * Math.sin(k * Math.PI / 24))]);
      return pts;
    }
    if (sh.type === 'rect') return [[ox, oy], [ox + W, oy], [ox + W, oy + H], [ox, oy + H]];
    // auto: прямоугольник по деталям с полями 2 мм
    const b = partsBBox(project);
    if (!b) return [[0, 0], [30, 0], [30, 20], [0, 20]];
    const m = 2;
    return [[b.x1 - m, b.y1 - m], [b.x2 + m, b.y1 - m], [b.x2 + m, b.y2 + m], [b.x1 - m, b.y2 + m]].map(p => p.map(R3));
  }

  // габарит детали на плате (по границе корпуса — courtyard)
  function partBox(comp, part) {
    const fp = footprint(comp);
    const [x1, y1, x2, y2] = fp.crt;
    const pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([x, y]) => { const [rx, ry] = rot(x, y, part.rot || 0); return [part.x + rx, part.y + ry]; });
    return { x1: Math.min(...pts.map(p => p[0])), y1: Math.min(...pts.map(p => p[1])), x2: Math.max(...pts.map(p => p[0])), y2: Math.max(...pts.map(p => p[1])), pts };
  }
  function partsBBox(project) {
    const pcb = project.pcb;
    let b = null;
    project.components.forEach(c => {
      const part = pcb.parts[c.id];
      if (!part || !footprint(c)) return;
      const r = partBox(c, part);
      b = b ? { x1: Math.min(b.x1, r.x1), y1: Math.min(b.y1, r.y1), x2: Math.max(b.x2, r.x2), y2: Math.max(b.y2, r.y2) } : r;
    });
    return b;
  }

  // ------------------------------------------------------------------ EasyEDA Standard
  // 1 единица EasyEDA = 10 mil = 0.254 мм; документ платы — docType 3
  function exportEasyEDA(project, nl) {
    const U = v => Math.round(v / 0.254 * 10000) / 10000;
    const X0 = 4000, Y0 = 3000;
    const X = v => R3(X0 + U(v)), Y = v => R3(Y0 + U(v));
    let gid = 1;
    const id = () => 'gge' + (gid++);
    const clean = s => String(s == null ? '' : s).replace(/[~`^#@$]/g, '_');
    const pts = list => list.map(([x, y]) => X(x) + ' ' + Y(y)).join(' ');
    const shapes = [];
    const ol = outline(project);
    shapes.push(`TRACK~1~10~~${pts(ol.concat([ol[0]]))}~${id()}~0`);
    const all = pads(project, nl);
    const uuid = () => AK.util.uuid().replace(/-/g, '');
    const now = Math.floor(Date.now() / 1000);
    project.components.forEach(c => {
      const part = project.pcb.parts[c.id], fp = footprint(c);
      if (!part || !fp) return;
      const d = AK.LIB[c.type];
      const tr = (x, y) => { const [rx, ry] = rot(x, y, part.rot || 0); return [part.x + rx, part.y + ry]; };
      const sub = [];
      all.filter(p => p.c === c).forEach(pp => {
        const p = pp.p, a = ((pp.a % 360) + 360) % 360;
        if (p.k === 'np_thru_hole') { sub.push(`HOLE~${X(pp.x)}~${Y(pp.y)}~${U(Array.isArray(p.d) ? p.d[0] / 2 : p.d / 2)}~${id()}~0`); return; }
        const shape = p.sh === 'circle' ? 'ELLIPSE' : p.sh === 'oval' ? 'OVAL' : 'RECT';
        const layer = p.k === 'smd' ? (p.l === 'B' ? 2 : 1) : 11;
        const local = (x, y) => { const [rx, ry] = rot(x, y, p.r || 0); return tr(p.x + rx, p.y + ry); };
        let ptStr = '';
        if (shape === 'RECT') ptStr = pts([[-p.w / 2, -p.h / 2], [p.w / 2, -p.h / 2], [p.w / 2, p.h / 2], [-p.w / 2, p.h / 2]].map(([x, y]) => local(x, y)));
        else if (shape === 'OVAL') {
          const l = Math.abs(p.w - p.h) / 2;
          ptStr = pts(p.w > p.h ? [local(-l, 0), local(l, 0)] : [local(0, -l), local(0, l)]);
        }
        let holeR = 0, holeLen = 0, holePts = '';
        if (p.d) {
          if (Array.isArray(p.d)) {
            const [dw, dh] = p.d;
            holeR = U(Math.min(dw, dh) / 2);
            holeLen = U(Math.abs(dw - dh));
            const l = Math.abs(dw - dh) / 2;
            holePts = pts(dw > dh ? [local(-l, 0), local(l, 0)] : [local(0, -l), local(0, l)]);
          } else holeR = U(p.d / 2);
        }
        sub.push(`PAD~${shape}~${X(pp.x)}~${Y(pp.y)}~${U(p.w)}~${U(p.h)}~${layer}~${clean(pp.net)}~${clean(p.n)}~${holeR}~${ptStr}~${a}~${id()}~${holeLen}~${holePts}~Y~0~0~0.2~${X(pp.x)},${Y(pp.y)}`);
      });
      fp.silk.forEach(l => sub.push(`TRACK~${Math.max(0.6, U(l.w))}~3~~${pts(l.p.map(([x, y]) => tr(x, y)))}~${id()}~0`));
      const t = refPos(c, part, fp);
      sub.push(`TEXT~P~${X(t[0])}~${Y(t[1])}~0.6~${t[2]}~0~3~~4~${clean(c.ref)}~~~${id()}~~0~`);
      const para = ['package', clean(fpName(c).split(':').pop()), 'pre', clean(c.ref), 'Value', clean(c.value || d.value)];
      if (d.lcsc) para.push('Supplier Part', clean(d.lcsc));
      shapes.push(`LIB~${X(part.x)}~${Y(part.y)}~${para.join('`')}\`~${(((part.rot || 0) % 360) + 360) % 360}~~${id()}~1~${uuid()}~${now}~0#@$${sub.join('#@$')}`);
    });
    (project.pcb.texts || []).forEach(t => shapes.push(`TEXT~L~${X(t.x)}~${Y(t.y)}~0.6~${t.rot || 0}~0~${t.bottom ? 4 : 3}~~${U(t.size || 1.2)}~${clean(t.text)}~~~${id()}~~0~`));
    const xs = ol.map(p => p[0]), ys = ol.map(p => p[1]);
    const head = { docType: '3', editorVersion: '6.5.51', newgId: true, c_para: {}, x: X0, y: Y0, hasIdFlag: true, importFlag: 0, transformList: '' };
    // слои — как у новой платы EasyEDA, но с видимыми связями (Ratlines), контуром и отверстиями:
    // без списка слоёв документ из исходника открывается с выключенными Ratlines и BoardOutLine
    const L = (id, name, color, on, active) => `${id}~${name}~${color}~${on}~${active ? 'true' : 'false'}~${on}~`;
    const layers = [L(1, 'TopLayer', '#FF0000', true, true), L(2, 'BottomLayer', '#0000FF', true), L(3, 'TopSilkLayer', '#FFCC00', true), L(4, 'BottomSilkLayer', '#66CC33', true),
      L(5, 'TopPasteMaskLayer', '#808080', true), L(6, 'BottomPasteMaskLayer', '#800000', true), L(7, 'TopSolderMaskLayer', '#800080', true), L(8, 'BottomSolderMaskLayer', '#AA00FF', true),
      L(9, 'Ratlines', '#6464FF', true), L(10, 'BoardOutLine', '#FF00FF', true), L(11, 'Multi-Layer', '#C0C0C0', true), L(12, 'Document', '#FFFFFF', true),
      L(13, 'TopAssembly', '#33CC99', false), L(14, 'BottomAssembly', '#5555FF', false), L(15, 'Mechanical', '#F022F0', false), L(19, '3DModel', '#66CCFF', false),
      L('Hole', 'Hole', '#222222', true), L('DRCError', 'DRCError', '#FAD609', true)];
    return {
      head,
      canvas: `CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~0.5~mm~1~45~visible~0.5~${X0}~${Y0}~0~yes`,
      shape: shapes,
      layers,
      preference: { hideFootprints: '', hideNets: '' },
      // дорожка 0.254 мм (10 mil), зазор 0.152 мм (6 mil), переходное 0.6/0.3 мм — по силам любому заводу
      DRCRULE: { Default: { trackWidth: 1, clearance: 0.6, viaHoleDiameter: 2.4, viaHoleD: 1.2 }, isRealtime: true, checkObjectToCopperarea: true, showDRCRangeLine: true },
      netColors: {},
      BBox: { x: X(Math.min(...xs)), y: Y(Math.min(...ys)), width: U(Math.max(...xs) - Math.min(...xs)), height: U(Math.max(...ys) - Math.min(...ys)) },
    };
  }

  // позиция обозначения: над корпусом (поворот текста — кратный 90°, чтобы читался)
  function refPos(c, part, fp) {
    const b = partBox(c, part);
    return [R3((b.x1 + b.x2) / 2), R3(b.y1 - 0.8), 0];
  }

  // ------------------------------------------------------------------ KiCad
  function exportKicad(project, nl) {
    const q = s => '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    const f = v => AK.util.fmt(v, 4);
    const U = () => q(AK.util.uuid());
    const all = pads(project, nl);
    const nets = [''].concat([...new Set(all.map(p => p.net).filter(Boolean))].sort());
    const netId = n => nets.indexOf(n);
    const out = [];
    out.push('(kicad_pcb (version 20240108) (generator "AutoKiCad") (generator_version "1.0")');
    out.push('  (general (thickness 1.6) (legacy_teardrops no))');
    out.push('  (paper "A4")');
    out.push('  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (32 "B.Adhes" user "B.Adhesive") (33 "F.Adhes" user "F.Adhesive") (34 "B.Paste" user) (35 "F.Paste" user)' +
      ' (36 "B.SilkS" user "B.Silkscreen") (37 "F.SilkS" user "F.Silkscreen") (38 "B.Mask" user) (39 "F.Mask" user) (40 "Dwgs.User" user "User.Drawings") (41 "Cmts.User" user "User.Comments")' +
      ' (44 "Edge.Cuts" user) (45 "Margin" user) (46 "B.CrtYd" user "B.Courtyard") (47 "F.CrtYd" user "F.Courtyard") (48 "B.Fab" user) (49 "F.Fab" user))');
    out.push('  (setup (pad_to_mask_clearance 0))');
    nets.forEach((n, i) => out.push(`  (net ${i} ${q(n)})`));
    const FONT = '(effects (font (size 1 1) (thickness 0.15)))';
    project.components.forEach(c => {
      const part = project.pcb.parts[c.id], fp = footprint(c);
      if (!part || !fp) return;
      const d = AK.LIB[c.type];
      // KiCad: угол против часовой стрелки
      const A = (((-(part.rot || 0)) % 360) + 360) % 360;
      const t = refPos(c, part, fp);
      const [lx, ly] = rot(t[0] - part.x, t[1] - part.y, -(part.rot || 0));
      out.push(`  (footprint ${q(fpName(c))} (layer "F.Cu") (uuid ${U()}) (at ${f(part.x)} ${f(part.y)} ${f(A)})`);
      out.push(`    (property "Reference" ${q(c.ref)} (at ${f(lx)} ${f(ly)} ${f(A)}) (layer "F.SilkS") (uuid ${U()}) ${FONT})`);
      out.push(`    (property "Value" ${q(c.value || d.value)} (at 0 0 ${f(A)}) (layer "F.Fab") (uuid ${U()}) ${FONT})`);
      out.push(`    (property "Footprint" ${q(fpName(c))} (at 0 0 0) (layer "F.Fab") (hide yes) (uuid ${U()}) ${FONT})`);
      fp.silk.forEach(l => {
        for (let i = 0; i < l.p.length - 1; i++) out.push(`    (fp_line (start ${f(l.p[i][0])} ${f(l.p[i][1])}) (end ${f(l.p[i + 1][0])} ${f(l.p[i + 1][1])}) (stroke (width ${f(l.w)}) (type solid)) (layer "F.SilkS") (uuid ${U()}))`);
      });
      const [cx1, cy1, cx2, cy2] = fp.crt;
      out.push(`    (fp_rect (start ${f(cx1)} ${f(cy1)}) (end ${f(cx2)} ${f(cy2)}) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd") (uuid ${U()}))`);
      all.filter(p => p.c === c).forEach(pp => {
        const p = pp.p;
        const sh = p.sh === 'roundrect' ? 'roundrect' : p.sh;
        const layers = p.k === 'smd' ? (p.l === 'B' ? '"B.Cu" "B.Paste" "B.Mask"' : '"F.Cu" "F.Paste" "F.Mask"') : '"*.Cu" "*.Mask"';
        const drill = p.d ? (Array.isArray(p.d) ? ` (drill oval ${f(p.d[0])} ${f(p.d[1])})` : ` (drill ${f(p.d)})`) : '';
        const net = pp.net ? ` (net ${netId(pp.net)} ${q(pp.net)})` : '';
        const rr = sh === 'roundrect' ? ` (roundrect_rratio ${p.rr || 0.25})` : '';
        out.push(`    (pad ${q(p.k === 'np_thru_hole' ? '' : p.n)} ${p.k} ${sh} (at ${f(p.x)} ${f(p.y)} ${f((A + (p.r ? -p.r : 0) + 360) % 360)}) (size ${f(p.w)} ${f(p.h)})${drill} (layers ${layers})${rr}${net} (uuid ${U()}))`);
      });
      out.push('  )');
    });
    const ol = outline(project);
    out.push(`  (gr_poly (pts ${ol.map(([x, y]) => `(xy ${f(x)} ${f(y)})`).join(' ')}) (stroke (width 0.1) (type solid)) (fill none) (layer "Edge.Cuts") (uuid ${U()}))`);
    (project.pcb.texts || []).forEach(t => out.push(`  (gr_text ${q(t.text)} (at ${f(t.x)} ${f(t.y)} ${f(-(t.rot || 0))}) (layer ${t.bottom ? '"B.SilkS"' : '"F.SilkS"'}) (uuid ${U()}) (effects (font (size ${f(t.size || 1.2)} ${f(t.size || 1.2)}) (thickness 0.15))${t.bottom ? ' (justify mirror)' : ''}))`));
    out.push(')');
    return out.join('\n') + '\n';
  }

  return { footprint, fpName, padPin, ensure, pads, ratsnest, outline, partBox, partsBBox, rot, exportEasyEDA, exportKicad, SHAPES, COLORS, HEART };
})();
