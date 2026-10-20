// Редактор «Монтаж»: компоненты в реальном виде и провода между выводами
window.AK = window.AK || {};

AK.WIRE_COLORS = ['#e53935', '#212121', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#eceff1'];

AK.Editor = class {
  constructor(svg, app) {
    this.svg = svg; this.app = app;
    this.view = { x: 400, y: 300, z: 1.8 };
    this.wireColor = 3; // сигнальные перемычки — зелёные
    svg.innerHTML = `<defs><pattern id="bgrid" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".9" fill="#c9d1db"/></pattern></defs>
      <g class="root">
        <rect x="-10000" y="-10000" width="20000" height="20000" fill="url(#bgrid)" class="bg"/>
        <g class="l-comps"></g><g class="l-wires"></g><g class="l-labels"></g><g class="l-pins"></g><g class="l-temp"></g>
      </g>`;
    this.root = svg.querySelector('.root');
    this.L = {
      comps: svg.querySelector('.l-comps'), wires: svg.querySelector('.l-wires'), labels: svg.querySelector('.l-labels'),
      pins: svg.querySelector('.l-pins'), temp: svg.querySelector('.l-temp'),
    };
    this.bind();
    this.applyView();
  }

  get P() { return this.app.project; }
  comp(id) { return this.P.components.find(c => c.id === id); }

  toWorld(e) {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left - this.view.x) / this.view.z, (e.clientY - r.top - this.view.y) / this.view.z];
  }
  applyView() {
    this.root.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.z})`);
  }
  zoomBy(f, cx, cy) {
    const r = this.svg.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const nz = Math.max(0.3, Math.min(8, this.view.z * f));
    this.view.x = cx - (cx - this.view.x) * nz / this.view.z;
    this.view.y = cy - (cy - this.view.y) * nz / this.view.z;
    this.view.z = nz;
    this.applyView();
  }
  fit() {
    const r = this.svg.getBoundingClientRect();
    if (!this.P.components.length || !r.width) return;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    this.P.components.forEach(c => { const b = AK.compWorldBox(c); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); });
    this.P.wires.forEach(w => w.points.forEach(([x, y]) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }));
    const z = Math.min(r.width / (x2 - x1 + 120), r.height / (y2 - y1 + 120), 4);
    this.view = { z, x: r.width / 2 - (x1 + x2) / 2 * z, y: r.height / 2 - (y1 + y2) / 2 * z };
    this.applyView();
  }

  wirePts(w) {
    const a = this.comp(w.from.c), b = this.comp(w.to.c);
    return [AK.pinWorld(a, w.from.p), ...w.points, AK.pinWorld(b, w.to.p)];
  }

  // ---------------- отрисовка ----------------
  render() {
    const P = this.P, sel = this.app.sel, e = AK.util.esc;
    // занятые выводы: к ним подходит провод или в той же точке стоит другой вывод (ножка в отверстии)
    const connected = new Set(), at = new Map();
    P.wires.forEach(w => { connected.add(w.from.c + ':' + w.from.p); connected.add(w.to.c + ':' + w.to.p); });
    P.components.forEach(c => Object.keys(AK.LIB[c.type].visual.pins).forEach(p => {
      const s = AK.pinWorld(c, p).map(Math.round).join(',');
      if (!at.has(s)) at.set(s, []);
      at.get(s).push(c.id + ':' + p);
    }));
    const isLeg = k => !AK.LIB[this.comp(k.split(':')[0]).type].board;
    at.forEach(ks => { if (ks.length > 1 && ks.some(isLeg)) ks.forEach(k => connected.add(k)); });

    let comps = '', labels = '', pins = '';
    const selSet = new Set(this.selIds());
    // макетные платы — под остальными компонентами
    const order = P.components.filter(c => AK.LIB[c.type].board).concat(P.components.filter(c => !AK.LIB[c.type].board));
    order.forEach(c => {
      const d = AK.LIB[c.type];
      const [bx, by, bw, bh] = d.visual.hit || d.visual.box;
      const isSel = selSet.has(c.id);
      comps += `<g class="comp${d.board ? ' board' : ''}${isSel ? ' sel' : ''}" data-id="${c.id}" transform="translate(${c.x} ${c.y}) rotate(${c.rot || 0})">` +
        d.visual.draw(c, { on: connected }) + (d.board ? '' : `<rect class="hit" x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="transparent"/>`) + '</g>';
      const wb = AK.compWorldBox(c);
      if (isSel) labels += `<rect class="selbox" x="${wb.x - 4}" y="${wb.y - 4}" width="${wb.w + 8}" height="${wb.h + 8}" rx="4"/>`;
      // у микросхем и модулей номинал напечатан на корпусе — в подписи только обозначение
      const label = e(c.ref) + (c.value && !d.refOnly ? ' · ' + e(c.value) : '');
      // у вертикально стоящих компонентов подпись сбоку, чтобы не закрывать соседние отверстия
      if (!d.virtual && wb.h > wb.w * 1.6 && d.type !== 'electrolytic') labels += `<text class="ref side" x="${wb.x + wb.w + 3}" y="${wb.y + wb.h / 2 + 3}">${label}</text>`;
      else if (!d.virtual) labels += `<text class="ref" x="${wb.x + wb.w / 2}" y="${wb.y - 6}">${label}</text>`;
      if (d.board) return; // отверстия платы нарисованы в её корпусе
      Object.keys(d.visual.pins).forEach(p => {
        const [x, y] = AK.pinWorld(c, p);
        const k = c.id + ':' + p;
        pins += `<circle class="pin${connected.has(k) ? ' on' : ''}" data-k="${k}" cx="${x}" cy="${y}" r="3.2"/>`;
      });
    });

    let wires = '';
    P.wires.forEach(w => {
      const pts = this.wirePts(w).map(p => p.join(',')).join(' ');
      const isSel = sel && sel.kind === 'wire' && sel.id === w.id;
      const col = w.color || AK.WIRE_COLORS[0];
      wires += `<g class="wire${isSel ? ' sel' : ''}" data-id="${w.id}" data-k1="${w.from.c}:${w.from.p}" data-k2="${w.to.c}:${w.to.p}">` +
        `<polyline class="w-hit" points="${pts}"/><polyline class="w-shadow" points="${pts}"/>` +
        `<polyline class="w-main" points="${pts}" stroke="${col}"/>`;
      if (isSel) w.points.forEach(([x, y], i) => { wires += `<circle class="handle" data-i="${i}" cx="${x}" cy="${y}" r="3.5"/>`; });
      if (w.net) {
        const all = this.wirePts(w), m = all[Math.floor((all.length - 1) / 2)], n2 = all[Math.floor((all.length - 1) / 2) + 1];
        wires += `<text class="wname" x="${(m[0] + n2[0]) / 2}" y="${(m[1] + n2[1]) / 2 - 5}">${e(w.net)}</text>`;
      }
      wires += '</g>';
    });

    this.L.comps.innerHTML = comps;
    this.L.wires.innerHTML = wires;
    this.L.labels.innerHTML = labels;
    this.L.pins.innerHTML = pins;
    this.renderTemp();
  }

  renderTemp() {
    let s = '';
    if (this.wiring) {
      const a = AK.pinWorld(this.comp(this.wiring.from.c), this.wiring.from.p);
      const pts = [a, ...this.wiring.points, this.wiring.cur || a].map(p => p.join(',')).join(' ');
      s += `<polyline class="w-temp" points="${pts}" stroke="${AK.WIRE_COLORS[this.wireColor]}"/>`;
    }
    if (this.box) {
      const b = this.box, x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
      s += `<rect class="selrect" x="${x}" y="${y}" width="${Math.abs(b.x1 - b.x0)}" height="${Math.abs(b.y1 - b.y0)}"/>`;
    }
    if (this.placing && this.placing.cur) {
      const d = AK.LIB[this.placing.type];
      const fake = { type: this.placing.type, value: d.value, ref: d.prefix + '?', props: this.defaultProps(d), rot: 0 };
      s += `<g class="ghost" transform="translate(${this.placing.cur[0]} ${this.placing.cur[1]})">${d.visual.draw(fake)}</g>`;
    }
    this.L.temp.innerHTML = s;
  }

  defaultProps(d) {
    const p = {};
    (d.props || []).forEach(x => { p[x.key] = x.def; });
    return p;
  }

  // ---------------- операции ----------------
  addComponent(type, x, y) {
    const d = AK.LIB[type];
    const [sx, sy] = AK.snapPos(type, 0, x, y);
    const c = {
      id: AK.util.uid('c'), type, ref: this.app.nextRef(d.prefix, d.virtual), value: d.value,
      x: sx, y: sy, rot: 0, props: this.defaultProps(d),
    };
    if (d.props && d.props.some(p => p.key === 'net')) c.value = c.props.net;
    this.P.components.push(c);
    return c;
  }

  // ---------------- выделение ----------------
  // выделенные компоненты: один (kind 'comp') или группа (kind 'multi')
  selIds() {
    const s = this.app.sel;
    if (!s) return [];
    if (s.kind === 'comp') return [s.id];
    if (s.kind === 'multi') return s.ids.filter(id => this.comp(id));
    return [];
  }
  setSel(ids) {
    this.app.select(!ids.length ? null : ids.length === 1 ? { kind: 'comp', id: ids[0] } : { kind: 'multi', ids });
  }
  selectAll() {
    this.cancel();
    this.setSel(this.P.components.map(c => c.id));
    this.render();
  }

  // что двигается вместе с выделением: сами компоненты, вставленные в выделенные платы,
  // и провода, у которых оба конца в этом наборе (их точки изгиба)
  moveSet(ids) {
    const set = new Set(ids);
    const pk = o => Object.keys(AK.LIB[o.type].visual.pins).map(p => AK.pinWorld(o, p).map(Math.round).join(','));
    ids.forEach(id => {
      const b = this.comp(id);
      if (!b || !AK.LIB[b.type].board) return;
      const holes = new Set(pk(b));
      this.P.components.forEach(o => { if (!AK.LIB[o.type].board && pk(o).some(s => holes.has(s))) set.add(o.id); });
    });
    return {
      comps: this.P.components.filter(c => set.has(c.id)),
      wires: this.P.wires.filter(w => set.has(w.from.c) && set.has(w.to.c)),
    };
  }
  shiftSet(ms, dx, dy) {
    ms.comps.forEach(o => { o.x += dx; o.y += dy; });
    ms.wires.forEach(w => { w.points = w.points.map(([x, y]) => [x + dx, y + dy]); });
  }

  nudge(dx, dy) {
    const ids = this.selIds();
    if (!ids.length) return;
    this.app.checkpoint();
    this.shiftSet(this.moveSet(ids), dx, dy);
    this.app.changed({ keepView: true });
  }

  deleteSelection() {
    const sel = this.app.sel;
    if (!sel) return;
    this.app.checkpoint();
    const ids = new Set(this.selIds());
    if (ids.size) {
      this.P.components = this.P.components.filter(c => !ids.has(c.id));
      this.P.wires = this.P.wires.filter(w => !ids.has(w.from.c) && !ids.has(w.to.c));
    } else {
      this.P.wires = this.P.wires.filter(w => w.id !== sel.id);
    }
    this.app.select(null);
    this.app.changed();
  }

  rotateSelection() {
    const ids = this.selIds();
    if (!ids.length) return;
    this.app.checkpoint();
    const ms = this.moveSet(ids);
    if (ms.comps.length === 1) {
      const c = ms.comps[0];
      c.rot = ((c.rot || 0) + 90) % 360;
      [c.x, c.y] = AK.snapPos(c.type, c.rot, c.x, c.y);
    } else {
      // группа поворачивается вокруг узла сетки в центре — выводы остаются в отверстиях
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      ms.comps.forEach(c => { const b = AK.compWorldBox(c); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); });
      const gx = Math.round((x1 + x2) / 20) * 10, gy = Math.round((y1 + y2) / 20) * 10;
      const R = ([x, y]) => { const [rx, ry] = AK.util.rotPt(x - gx, y - gy, 90); return [gx + rx, gy + ry]; };
      ms.comps.forEach(c => { [c.x, c.y] = R([c.x, c.y]); c.rot = ((c.rot || 0) + 90) % 360; });
      ms.wires.forEach(w => { w.points = w.points.map(R); });
    }
    this.app.changed();
  }

  // ---------------- буфер обмена ----------------
  makeClip(ids) {
    const ms = this.moveSet(ids);
    if (!ms.comps.length) return null;
    const ee = {};
    ms.comps.forEach(c => { const d = AK.LIB[c.type]; if (d.ee && this.P.eeParts && this.P.eeParts[d.ee.uuid]) ee[d.ee.uuid] = this.P.eeParts[d.ee.uuid]; });
    // ширина группы — копия ставится справа от оригинала, не налезая на него (иначе отверстия плат совпадут)
    let x1 = Infinity, x2 = -Infinity;
    ms.comps.forEach(c => { const b = AK.compWorldBox(c); x1 = Math.min(x1, b.x); x2 = Math.max(x2, b.x + b.w); });
    ms.wires.forEach(w => w.points.forEach(([x]) => { x1 = Math.min(x1, x); x2 = Math.max(x2, x); }));
    const step = Math.ceil((x2 - x1 + 20) / 10) * 10;
    return JSON.parse(JSON.stringify({ comps: ms.comps, wires: ms.wires, eeParts: ee, step }));
  }
  copySelection() {
    const clip = this.makeClip(this.selIds());
    if (!clip) return false;
    AK.clipboard = clip;
    this.pasteN = 0;
    try { localStorage.setItem('autokicad.clipboard', JSON.stringify(clip)); } catch (e) { /* хранилище недоступно */ }
    return true;
  }
  paste() {
    let clip = AK.clipboard;
    if (!clip) { try { clip = JSON.parse(localStorage.getItem('autokicad.clipboard')); } catch (e) { clip = null; } }
    if (!clip || !clip.comps || !clip.comps.length) { this.app.toast('Буфер пуст: выделите компоненты и нажмите Ctrl+C'); return; }
    this.pasteN = (this.pasteN || 0) + 1;
    this.insertClip(clip, clip.step * this.pasteN, 0);
  }
  duplicateSelection() {
    const clip = this.makeClip(this.selIds());
    if (clip) this.insertClip(clip, clip.step, 0);
  }
  insertClip(clip, dx, dy) {
    this.cancel();
    this.app.checkpoint();
    if (Object.keys(clip.eeParts || {}).length) {
      this.P.eeParts = Object.assign({}, clip.eeParts, this.P.eeParts);
      AK.EE.register(this.P);
    }
    const map = {}, ids = [];
    clip.comps.forEach(src => {
      const d = AK.LIB[src.type];
      if (!d) return;
      const c = JSON.parse(JSON.stringify(src));
      c.id = AK.util.uid('c');
      c.ref = this.app.nextRef(d.prefix, d.virtual);
      c.x += dx; c.y += dy;
      map[src.id] = c.id;
      this.P.components.push(c);
      ids.push(c.id);
    });
    clip.wires.forEach(src => {
      if (!map[src.from.c] || !map[src.to.c]) return;
      this.P.wires.push(Object.assign(JSON.parse(JSON.stringify(src)), {
        id: AK.util.uid('w'), from: { c: map[src.from.c], p: src.from.p }, to: { c: map[src.to.c], p: src.to.p },
        points: src.points.map(([x, y]) => [x + dx, y + dy]),
      }));
    });
    this.setSel(ids);
    this.app.changed();
  }

  cancel() {
    if (this.wiring || this.placing) {
      this.wiring = null; this.placing = null;
      this.renderTemp();
      this.app.hint('');
      return true;
    }
    return false;
  }

  startPlacing(type) {
    this.cancel();
    this.placing = { type };
    this.app.hint(`Кликните на поле, чтобы поставить «${AK.LIB[type].name}». Esc — отмена.`);
  }

  finishWire(k) {
    const [c, p] = k.split(':');
    const f = this.wiring.from;
    if (c === f.c && p === f.p) return false;
    this.app.checkpoint();
    // провод к шине «−» / земле — чёрный, к шине «+» — красный, остальные — выбранного цвета
    const ends = [f, { c, p }].map(x => { const o = this.comp(x.c); return AK.LIB[o.type].board ? AK.pinName(o.type, x.p) : o.type; });
    let color = AK.WIRE_COLORS[this.wireColor];
    if (ends.some(s => /−|^gnd$/.test(s))) color = AK.WIRE_COLORS[1];
    else if (ends.some(s => /\+|^power$/.test(s))) color = AK.WIRE_COLORS[0];
    const w = { id: AK.util.uid('w'), from: f, to: { c, p }, points: this.wiring.points, color, net: '' };
    this.P.wires.push(w);
    this.wiring = null;
    this.app.hint('');
    this.app.select({ kind: 'wire', id: w.id });
    this.app.changed();
    return true;
  }

  // ---------------- события ----------------
  bind() {
    const svg = this.svg;
    const snap5 = v => Math.round(v / 5) * 5;

    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    svg.addEventListener('contextmenu', e => { e.preventDefault(); if (!this.panMoved) this.cancel(); });

    svg.addEventListener('pointerdown', e => {
      const [wx, wy] = this.toWorld(e);
      // сдвиг поля — средней или правой кнопкой (как в EasyEDA), либо Alt + левой
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        this.panMoved = false;
        this.pan = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;

      if (this.placing) {
        this.app.checkpoint();
        const c = this.addComponent(this.placing.type, wx, wy);
        if (!e.shiftKey) { this.placing = null; this.app.hint(''); }
        this.app.select({ kind: 'comp', id: c.id });
        this.app.changed();
        return;
      }

      const pinEl = e.target.closest('.pin');
      if (this.wiring) {
        if (pinEl) {
          this.finishWire(pinEl.dataset.k);
        } else {
          this.wiring.points.push([snap5(wx), snap5(wy)]);
          this.renderTemp();
        }
        return;
      }

      if (pinEl) {
        const [c, p] = pinEl.dataset.k.split(':');
        // провод можно протянуть мышью (отпустить над другим выводом) или поставить двумя кликами
        this.wiring = { from: { c, p }, points: [], cur: [wx, wy], down: true };
        this.app.hint('Отпустите или кликните над другим выводом / отверстием. Клик по пустому месту — точка изгиба. Esc / ПКМ — отмена.');
        this.renderTemp();
        return;
      }

      const handle = e.target.closest('.handle');
      if (handle) {
        const wid = handle.closest('.wire').dataset.id;
        this.hdrag = { wid, i: +handle.dataset.i, moved: false };
        svg.setPointerCapture(e.pointerId);
        return;
      }

      const wireEl = e.target.closest('.wire');
      if (wireEl) {
        // без перерисовки при повторном клике, иначе dblclick теряет цель
        const s = this.app.sel;
        if (!(s && s.kind === 'wire' && s.id === wireEl.dataset.id)) {
          this.app.select({ kind: 'wire', id: wireEl.dataset.id });
          this.render();
        }
        return;
      }

      const compEl = e.target.closest('.comp');
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      const onBoard = compEl && AK.LIB[this.comp(compEl.dataset.id).type].board;
      if (compEl && !(add && onBoard)) {
        const c = this.comp(compEl.dataset.id);
        let ids = this.selIds();
        if (add) {
          // Ctrl/Shift + клик — добавить компонент в выделение или убрать из него
          ids = ids.includes(c.id) ? ids.filter(id => id !== c.id) : ids.concat(c.id);
          this.setSel(ids);
          this.render();
          return;
        }
        if (!ids.includes(c.id)) { ids = [c.id]; this.setSel(ids); }
        // вместе с компонентом едет всё выделенное; плата везёт вставленные в неё компоненты и перемычки
        this.drag = { id: c.id, ox: wx - c.x, oy: wy - c.y, moved: false, set: this.moveSet(ids) };
        svg.setPointerCapture(e.pointerId);
        this.render();
        return;
      }

      // рамка выделения: по пустому месту, или с Shift/Ctrl — и поверх платы
      this.box = { x0: wx, y0: wy, x1: wx, y1: wy, add, base: add ? this.selIds() : [], sx: e.clientX, sy: e.clientY };
      svg.setPointerCapture(e.pointerId);
    });

    svg.addEventListener('pointermove', e => {
      const [wx, wy] = this.toWorld(e);
      if (this.pan) {
        if (Math.abs(e.clientX - this.pan.x) + Math.abs(e.clientY - this.pan.y) > 3) this.panMoved = true;
        this.view.x = this.pan.vx + e.clientX - this.pan.x;
        this.view.y = this.pan.vy + e.clientY - this.pan.y;
        this.applyView();
        return;
      }
      if (this.box) {
        this.box.x1 = wx; this.box.y1 = wy;
        this.renderTemp();
        return;
      }
      if (this.drag) {
        const c = this.comp(this.drag.id);
        const [nx, ny] = AK.snapPos(c.type, c.rot, wx - this.drag.ox, wy - this.drag.oy);
        if (nx !== c.x || ny !== c.y) {
          if (!this.drag.moved) { this.app.checkpoint(); this.drag.moved = true; }
          this.shiftSet(this.drag.set, nx - c.x, ny - c.y);
          this.render();
        }
        return;
      }
      if (this.hdrag) {
        const w = this.P.wires.find(x => x.id === this.hdrag.wid);
        if (!this.hdrag.moved) { this.app.checkpoint(); this.hdrag.moved = true; }
        w.points[this.hdrag.i] = [snap5(wx), snap5(wy)];
        this.render();
        return;
      }
      if (this.wiring) { this.wiring.cur = [wx, wy]; this.renderTemp(); }
      if (this.placing) { this.placing.cur = AK.snapPos(this.placing.type, 0, wx, wy); this.renderTemp(); }
      this.hover(e);
    });

    const up = e => {
      if (this.wiring && this.wiring.down) {
        this.wiring.down = false;
        const pinEl = e.target && e.target.closest && e.target.closest('.pin');
        if (pinEl && this.finishWire(pinEl.dataset.k)) return;
      }
      if (this.box) {
        const b = this.box;
        this.box = null;
        if (Math.abs(e.clientX - b.sx) + Math.abs(e.clientY - b.sy) < 4) {
          // простой клик по пустому месту — снять выделение
          if (!b.add) this.app.select(null);
        } else {
          // выделяются компоненты, целиком попавшие в рамку
          const x1 = Math.min(b.x0, b.x1), x2 = Math.max(b.x0, b.x1), y1 = Math.min(b.y0, b.y1), y2 = Math.max(b.y0, b.y1);
          const inside = this.P.components.filter(c => {
            const r = AK.compWorldBox(c);
            return r.x >= x1 && r.y >= y1 && r.x + r.w <= x2 && r.y + r.h <= y2;
          }).map(c => c.id);
          this.setSel([...new Set(b.base.concat(inside))]);
        }
        this.render();
        return;
      }
      const moved = (this.drag && this.drag.moved) || (this.hdrag && this.hdrag.moved);
      this.drag = null; this.hdrag = null; this.pan = null;
      if (moved) this.app.changed();
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', () => this.app.tooltip(null));

    // двойной клик по проводу — добавить точку изгиба
    svg.addEventListener('dblclick', e => {
      const wireEl = e.target.closest('.wire');
      if (!wireEl) return;
      const w = this.P.wires.find(x => x.id === wireEl.dataset.id);
      const [wx, wy] = this.toWorld(e);
      const pts = this.wirePts(w);
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distSeg(wx, wy, pts[i], pts[i + 1]);
        if (d < bd) { bd = d; best = i; }
      }
      this.app.checkpoint();
      w.points.splice(best, 0, [snap5(wx), snap5(wy)]);
      this.app.select({ kind: 'wire', id: w.id });
      this.app.changed();
    });

    // перетаскивание из палитры
    svg.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    svg.addEventListener('drop', e => {
      e.preventDefault();
      const type = e.dataTransfer.getData('text/x-akc-type');
      if (!type || !AK.LIB[type]) return;
      const [wx, wy] = this.toWorld(e);
      this.app.checkpoint();
      const c = this.addComponent(type, wx, wy);
      this.app.select({ kind: 'comp', id: c.id });
      this.app.changed();
    });

    function distSeg(x, y, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
    }
  }

  hover(e) {
    const pinEl = e.target.closest && e.target.closest('.pin');
    const k = pinEl ? pinEl.dataset.k : null;
    if (k === this.hoverKey) { if (k) this.app.tooltip(this.tipText, e); return; }
    this.hoverKey = k;
    this.svg.querySelectorAll('.hl').forEach(n => n.classList.remove('hl'));
    if (!k) { this.app.tooltip(null); return; }
    const [cid, p] = k.split(':');
    const c = this.comp(cid);
    const nl = this.app.netlist();
    const net = nl.pinNet.get(k);
    const keys = new Set(net ? net.pins.map(x => x.c + ':' + x.p) : [k]);
    this.svg.querySelectorAll('.pin').forEach(n => { if (keys.has(n.dataset.k)) n.classList.add('hl'); });
    this.L.wires.querySelectorAll('.wire').forEach(n => { if (keys.has(n.dataset.k1)) n.classList.add('hl'); });
    const d = AK.LIB[c.type];
    this.tipText = `<b>${AK.util.esc(d.virtual ? d.name : c.ref)}</b> · вывод ${AK.util.esc(AK.pinName(c.type, p))}` +
      (net && net.name && net.drawn ? `<br>цепь <b>${AK.util.esc(net.name)}</b> (${net.real.length} выв.)` : '<br><i>не подключён</i>');
    this.app.tooltip(this.tipText, e);
  }
};
