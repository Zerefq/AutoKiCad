// Автоматическая генерация принципиальной схемы из netlist.
// Координаты в единицах U (100 mil), ось Y вниз, все выводы на целой сетке.
window.AK = window.AK || {};

AK.OUT = { R: [-1, 0], L: [1, 0], U: [0, 1], D: [0, -1] }; // dir вывода -> направление «наружу»
AK.isGndName = n => /^(GND|AGND|DGND|PGND|VSS|VEE)$/i.test(n) || /^-/.test(n);

AK.generateSchematic = function (project, nl) {
  const comps = project.components.filter(c => !AK.LIB[c.type].virtual);
  const sym = c => AK.LIB[c.type].sym;
  const K = (c, p) => c.id + ':' + p;
  const netOf = (c, p) => { const n = nl.pinNet.get(K(c, p)); return n && n.drawn ? n : null; };

  // ---------------- Расстановка ----------------
  const MX = 2.5, MY = 1.5;
  const pos = new Map();
  const rects = [];
  const rectAt = (c, x, y) => { const b = sym(c).bbox; return { x1: x + b.x1, y1: y + b.y1, x2: x + b.x2, y2: y + b.y2 }; };
  const overlaps = r => rects.some(q => r.x1 - MX < q.x2 + MX && r.x2 + MX > q.x1 - MX && r.y1 - MY < q.y2 + MY && r.y2 + MY > q.y1 - MY);
  const put = (c, x, y) => { pos.set(c.id, { x, y }); rects.push(rectAt(c, x, y)); };

  // сигнальные цепи компонента (цепи питания на расстановку не влияют)
  const sigNets = new Map(comps.map(c => [c.id, new Set(Object.keys(sym(c).pins).map(p => netOf(c, p)).filter(n => n && !n.power))]));
  const weight = (a, b) => { let w = 0; sigNets.get(a.id).forEach(n => { if (sigNets.get(b.id).has(n)) w++; }); return w; };

  comps.forEach(c => { if (c.sch && isFinite(c.sch.x)) put(c, Math.round(c.sch.x), Math.round(c.sch.y)); });
  let rest = comps.filter(c => !pos.has(c.id));

  function cost(c, x, y) {
    let s = 0;
    const s0 = sym(c);
    Object.entries(s0.pins).forEach(([p, pp]) => {
      const n = netOf(c, p);
      if (!n || n.power) return;
      let best = Infinity;
      n.real.forEach(q => {
        if (q.c === c.id || !pos.has(q.c)) return;
        const oc = comps.find(o => o.id === q.c), op = pos.get(q.c), qp = sym(oc).pins[q.p];
        best = Math.min(best, Math.abs(x + pp.x - op.x - qp.x) + Math.abs(y + pp.y - op.y - qp.y));
      });
      if (best < Infinity) s += best;
    });
    return s;
  }

  while (rest.length) {
    // следующий — самый связанный с уже поставленными (или вообще самый связанный)
    const placedList = comps.filter(c => pos.has(c.id));
    let pick = null, pw = -1;
    rest.forEach(c => {
      let w = placedList.length ? placedList.reduce((a, o) => a + weight(c, o), 0) * 100 : 0;
      w += rest.reduce((a, o) => a + (o !== c ? weight(c, o) : 0), 0) + Object.keys(sym(c).pins).length * 0.01;
      if (w > pw) { pw = w; pick = c; }
    });
    const c = pick;
    rest = rest.filter(o => o !== c);

    // центр поиска — среднее положение связанных выводов
    let cx = 0, cy = 0, cnt = 0;
    placedList.forEach(o => { if (weight(c, o) > 0) { const p = pos.get(o.id); cx += p.x; cy += p.y; cnt++; } });
    if (!cnt && placedList.length) {
      placedList.forEach(o => { const p = pos.get(o.id); cx += p.x; cy += p.y; cnt++; });
      // несвязанные — справа от всего остального
      const maxX = Math.max(...rects.map(r => r.x2));
      cx = maxX + 4 - sym(c).bbox.x1; cy = cy / cnt; cnt = 1;
    }
    if (cnt) { cx = Math.round(cx / cnt); cy = Math.round(cy / cnt); }

    let best = null, bestCost = Infinity, firstR = -1;
    for (let r = 0; r < 80; r++) {
      if (firstR >= 0 && r > firstR + 6) break;
      const ring = [];
      if (r === 0) ring.push([0, 0]);
      else {
        for (let i = -r; i <= r; i++) { ring.push([i, -r], [i, r]); }
        for (let i = -r + 1; i <= r - 1; i++) { ring.push([-r, i], [r, i]); }
      }
      ring.forEach(([dx, dy]) => {
        const x = cx + dx, y = cy + dy;
        if (overlaps(rectAt(c, x, y))) return;
        if (firstR < 0) firstR = r;
        const k = cost(c, x, y) + 0.15 * (Math.abs(dx) + Math.abs(dy));
        if (k < bestCost) { bestCost = k; best = [x, y]; }
      });
    }
    put(c, best[0], best[1]);
  }

  // ---------------- Трассировка ----------------
  const segs = [];   // {x1,y1,x2,y2,net}
  const pts = [];    // {x,y,net}
  const obst = comps.map(c => { const p = pos.get(c.id), r = rectAt(c, p.x, p.y); return { x1: r.x1 - 0.5, y1: r.y1 - 0.5, x2: r.x2 + 0.5, y2: r.y2 + 0.5 }; });
  const labels = [], power = [], ncs = [], wires = [];

  const onSeg = (x, y, s) => (s.x1 === s.x2 ? (x === s.x1 && y >= Math.min(s.y1, s.y2) && y <= Math.max(s.y1, s.y2))
    : (y === s.y1 && x >= Math.min(s.x1, s.x2) && x <= Math.max(s.x1, s.x2)));
  // отрезок проходит через внутренность прямоугольника
  const segHitsRect = (s, r) => Math.max(s.x1, s.x2) > r.x1 && Math.min(s.x1, s.x2) < r.x2 &&
    Math.max(s.y1, s.y2) > r.y1 && Math.min(s.y1, s.y2) < r.y2;

  function segOk(s, net, extraRects) {
    if (s.x1 === s.x2 && s.y1 === s.y2) return true;
    for (const r of obst) if (segHitsRect(s, r)) return false;
    if (extraRects) for (const r of extraRects) if (r.net !== net && segHitsRect(s, r)) return false;
    for (const p of pts) if (p.net !== net && onSeg(p.x, p.y, s)) return false;
    for (const o of segs) {
      if (o.net === net) continue;
      const sv = s.x1 === s.x2, ov = o.x1 === o.x2;
      if (sv === ov) {
        // коллинеарные отрезки разных цепей не должны касаться
        if (sv && s.x1 === o.x1 && Math.max(Math.min(s.y1, s.y2), Math.min(o.y1, o.y2)) <= Math.min(Math.max(s.y1, s.y2), Math.max(o.y1, o.y2))) return false;
        if (!sv && s.y1 === o.y1 && Math.max(Math.min(s.x1, s.x2), Math.min(o.x1, o.x2)) <= Math.min(Math.max(s.x1, s.x2), Math.max(o.x1, o.x2))) return false;
      } else {
        // пересечение допускается, а Т-образное касание — нет (это было бы соединение)
        const [vx, vy1, vy2, hy, hx1, hx2] = sv
          ? [s.x1, Math.min(s.y1, s.y2), Math.max(s.y1, s.y2), o.y1, Math.min(o.x1, o.x2), Math.max(o.x1, o.x2)]
          : [o.x1, Math.min(o.y1, o.y2), Math.max(o.y1, o.y2), s.y1, Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
        if (vx >= hx1 && vx <= hx2 && hy >= vy1 && hy <= vy2) {
          const isEnd = (x, y, q) => (q.x1 === x && q.y1 === y) || (q.x2 === x && q.y2 === y);
          if (isEnd(vx, hy, s) || isEnd(vx, hy, o)) return false;
        }
      }
    }
    return true;
  }

  const addSeg = (x1, y1, x2, y2, net) => {
    if (x1 === x2 && y1 === y2) return;
    const s = { x1, y1, x2, y2, net };
    segs.push(s);
    wires.push(s);
  };

  // 1. Отводы (стабы) от каждого подключённого вывода
  const stubs = new Map(); // net -> [{x,y,out,pin:[x,y],comp}]
  comps.forEach(c => {
    const p0 = pos.get(c.id);
    Object.entries(sym(c).pins).forEach(([p, pp]) => {
      const px = p0.x + pp.x, py = p0.y + pp.y;
      const n = netOf(c, p);
      if (!n) { ncs.push([px, py]); pts.push({ x: px, y: py, net: -1 }); return; }
      const out = AK.OUT[pp.dir];
      pts.push({ x: px, y: py, net: n.id });
      const st = { x: px + out[0], y: py + out[1], out, px, py, comp: c, cx: p0.x };
      if (!stubs.has(n)) stubs.set(n, []);
      stubs.get(n).push(st);
    });
  });
  stubs.forEach((list, n) => list.forEach(st => {
    addSeg(st.px, st.py, st.x, st.y, n.id);
    pts.push({ x: st.x, y: st.y, net: n.id });
  }));

  // 2. Символы питания
  const pwrRects = [];
  // место под возможную метку у каждого сигнального отвода — символы питания его не занимают
  const labelZones = [];
  stubs.forEach((list, n) => {
    if (n.power) return;
    const L = 0.6 + 0.5 * String(n.name || 'N1').length;
    list.forEach(st => {
      const o = st.out, ex = st.x + o[0] * L, ey = st.y + o[1] * L;
      labelZones.push({ x1: Math.min(st.x, ex) - (o[0] ? 0 : 0.45), x2: Math.max(st.x, ex) + (o[0] ? 0 : 0.45), y1: Math.min(st.y, ey) - (o[1] ? 0 : 0.45), y2: Math.max(st.y, ey) + (o[1] ? 0 : 0.45) });
    });
  });
  const hit = (r, q) => r.x1 < q.x2 && r.x2 > q.x1 && r.y1 < q.y2 && r.y2 > q.y1;
  const regionFree = (r, net, zones) => {
    for (const o of obst) if (hit(r, o)) return false;
    for (const q of pwrRects) if (hit(r, q)) return false;
    if (zones) for (const q of labelZones) if (hit(r, q)) return false;
    for (const p of pts) if (p.net !== net && p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2) return false;
    for (const s of segs) if (s.net !== net && segHitsRect(s, r)) return false;
    return true;
  };
  stubs.forEach((list, n) => {
    if (!n.power) return;
    const gnd = AK.isGndName(n.name);
    list.forEach(st => {
      // область символа вместе с подписью (+9V, VCC… над чертой)
      const tw = Math.max(0.7, 0.3 * String(n.name).length);
      const reg = (x, y) => gnd ? { x1: x - 0.8, y1: y, x2: x + 0.8, y2: y + 1.4 } : { x1: x - tw, y1: y - 1.9, x2: x + tw, y2: y };
      const against = gnd ? st.out[1] < 0 : st.out[1] > 0; // символ «смотрит» обратно на вывод
      const side = st.px >= st.cx ? 1 : -1;
      let ok = null;
      // сначала — не занимая места будущих меток, затем без этого ограничения
      for (const zones of [true, false]) {
        for (let t = 0; t <= 6 && !ok; t++) {
          let path;
          if (!against) path = [[st.x, st.y], [st.x + st.out[0] * t, st.y + st.out[1] * t]];
          else path = [[st.x, st.y], [st.x, st.y], [st.x + side * (2 + t), st.y]];
          const end = path[path.length - 1];
          const r = reg(end[0], end[1]);
          let good = regionFree(r, n.id, zones);
          for (let i = 0; good && i < path.length - 1; i++) {
            good = segOk({ x1: path[i][0], y1: path[i][1], x2: path[i + 1][0], y2: path[i + 1][1] }, n.id, pwrRects);
          }
          if (good) ok = { path, r };
        }
        if (ok) break;
      }
      if (!ok) { // запасной вариант — как есть
        ok = { path: [[st.x, st.y]], r: reg(st.x, st.y) };
      }
      for (let i = 0; i < ok.path.length - 1; i++) addSeg(ok.path[i][0], ok.path[i][1], ok.path[i + 1][0], ok.path[i + 1][1], n.id);
      const e = ok.path[ok.path.length - 1];
      pts.push({ x: e[0], y: e[1], net: n.id });
      ok.r.net = n.id;
      pwrRects.push(ok.r);
      power.push({ x: e[0], y: e[1], name: n.name, kind: gnd ? 'gnd' : 'vcc' });
    });
  });

  // 3. Сигнальные цепи: минимальное остовное дерево + Г/Z-образные трассы, иначе — метки
  const dirOf = out => out[0] > 0 ? 'R' : out[0] < 0 ? 'L' : out[1] < 0 ? 'U' : 'D';
  const labeled = new Set();
  const addLabel = (st, n) => {
    const k = st.x + ',' + st.y;
    if (labeled.has(k)) return;
    labeled.add(k);
    labels.push({ x: st.x, y: st.y, dir: dirOf(st.out), text: n.name, net: n.id });
  };

  function candidates(a, b) {
    const list = [];
    if (a.x === b.x || a.y === b.y) list.push([[a.x, a.y], [b.x, b.y]]);
    list.push([[a.x, a.y], [b.x, a.y], [b.x, b.y]]);
    list.push([[a.x, a.y], [a.x, b.y], [b.x, b.y]]);
    const xs = [], ys = [];
    const lo = (u, v) => Math.min(u, v), hi = (u, v) => Math.max(u, v);
    for (let x = lo(a.x, b.x) + 1; x < hi(a.x, b.x); x++) xs.push(x);
    for (let y = lo(a.y, b.y) + 1; y < hi(a.y, b.y); y++) ys.push(y);
    const mid = (arr, m) => arr.sort((p, q) => Math.abs(p - m) - Math.abs(q - m));
    mid(xs, (a.x + b.x) / 2).forEach(x => list.push([[a.x, a.y], [x, a.y], [x, b.y], [b.x, b.y]]));
    mid(ys, (a.y + b.y) / 2).forEach(y => list.push([[a.x, a.y], [a.x, y], [b.x, y], [b.x, b.y]]));
    for (let k = 1; k <= 4; k++) {
      [lo(a.x, b.x) - k, hi(a.x, b.x) + k].forEach(x => list.push([[a.x, a.y], [x, a.y], [x, b.y], [b.x, b.y]]));
      [lo(a.y, b.y) - k, hi(a.y, b.y) + k].forEach(y => list.push([[a.x, a.y], [a.x, y], [b.x, y], [b.x, b.y]]));
    }
    return list;
  }

  const signalNets = [...stubs.keys()].filter(n => !n.power).sort((p, q) => stubs.get(p).length - stubs.get(q).length);
  signalNets.forEach(n => {
    const list = stubs.get(n);
    if (list.length < 2) { list.forEach(st => addLabel(st, n)); return; }
    // Прим
    const inTree = [0], edges = [];
    while (inTree.length < list.length) {
      let best = null;
      inTree.forEach(i => list.forEach((b, j) => {
        if (inTree.includes(j)) return;
        const a = list[i], d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (!best || d < best.d) best = { i, j, d };
      }));
      inTree.push(best.j);
      edges.push(best);
    }
    edges.forEach(e => {
      const a = list[e.i], b = list[e.j];
      let route = null;
      if (e.d <= 30) {
        for (const cand of candidates(a, b)) {
          let good = true;
          for (let i = 0; good && i < cand.length - 1; i++) {
            good = segOk({ x1: cand[i][0], y1: cand[i][1], x2: cand[i + 1][0], y2: cand[i + 1][1] }, n.id, pwrRects);
          }
          if (good) { route = cand; break; }
        }
      }
      if (route) {
        for (let i = 0; i < route.length - 1; i++) addSeg(route[i][0], route[i][1], route[i + 1][0], route[i + 1][1], n.id);
        route.forEach(([x, y]) => pts.push({ x, y, net: n.id }));
      } else {
        addLabel(a, n); addLabel(b, n);
      }
    });
  });

  // 4. Точки соединения: там, где сходятся 3+ конца провода
  const ends = new Map();
  wires.forEach(s => [[s.x1, s.y1], [s.x2, s.y2]].forEach(([x, y]) => { const k = x + ',' + y; ends.set(k, (ends.get(k) || 0) + 1); }));
  const pinSet = new Set();
  comps.forEach(c => { const p0 = pos.get(c.id); Object.values(sym(c).pins).forEach(pp => pinSet.add((p0.x + pp.x) + ',' + (p0.y + pp.y))); });
  const junctions = [];
  ends.forEach((cnt, k) => { if (cnt + (pinSet.has(k) ? 1 : 0) >= 3) junctions.push(k.split(',').map(Number)); });

  // габариты
  let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
  const grow = (x1, y1, x2, y2) => { bx1 = Math.min(bx1, x1); by1 = Math.min(by1, y1); bx2 = Math.max(bx2, x2); by2 = Math.max(by2, y2); };
  rects.forEach(r => grow(r.x1, r.y1 - 1.5, r.x2, r.y2 + 1.5));
  wires.forEach(s => grow(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)));
  pwrRects.forEach(r => grow(r.x1, r.y1 - 0.8, r.x2, r.y2 + 0.8));
  labels.forEach(l => grow(l.x - 4, l.y - 4, l.x + 4, l.y + 4));
  if (!isFinite(bx1)) { bx1 = 0; by1 = 0; bx2 = 10; by2 = 10; }

  return {
    symbols: comps.map(c => ({ comp: c, def: AK.LIB[c.type], x: pos.get(c.id).x, y: pos.get(c.id).y })),
    wires, labels, power, junctions, ncs,
    bbox: { x1: bx1, y1: by1, x2: bx2, y2: by2 },
    nets: nl.drawn,
  };
};
