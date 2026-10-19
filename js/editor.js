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
    at.forEach(ks => { if (ks.length > 1) ks.forEach(k => connected.add(k)); });

    let comps = '', labels = '', pins = '';
    // макетные платы — под остальными компонентами
    const order = P.components.filter(c => AK.LIB[c.type].board).concat(P.components.filter(c => !AK.LIB[c.type].board));
    order.forEach(c => {
      const d = AK.LIB[c.type];
      const [bx, by, bw, bh] = d.visual.hit || d.visual.box;
      const isSel = sel && sel.kind === 'comp' && sel.id === c.id;
      comps += `<g class="comp${d.board ? ' board' : ''}${isSel ? ' sel' : ''}" data-id="${c.id}" transform="translate(${c.x} ${c.y}) rotate(${c.rot || 0})">` +
        d.visual.draw(c, { on: connected }) + (d.board ? '' : `<rect class="hit" x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="transparent"/>`) + '</g>';
      const wb = AK.compWorldBox(c);
      if (isSel) labels += `<rect class="selbox" x="${wb.x - 4}" y="${wb.y - 4}" width="${wb.w + 8}" height="${wb.h + 8}" rx="4"/>`;
      const label = e(c.ref) + (c.value && d.type !== 'nano' && d.type !== 'ne555' ? ' · ' + e(c.value) : '');
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

  deleteSelection() {
    const sel = this.app.sel;
    if (!sel) return;
    this.app.checkpoint();
    if (sel.kind === 'comp') {
      this.P.components = this.P.components.filter(c => c.id !== sel.id);
      this.P.wires = this.P.wires.filter(w => w.from.c !== sel.id && w.to.c !== sel.id);
    } else {
      this.P.wires = this.P.wires.filter(w => w.id !== sel.id);
    }
    this.app.select(null);
    this.app.changed();
  }

  rotateSelection() {
    const sel = this.app.sel;
    if (!sel || sel.kind !== 'comp') return;
    this.app.checkpoint();
    const c = this.comp(sel.id);
    c.rot = ((c.rot || 0) + 90) % 360;
    [c.x, c.y] = AK.snapPos(c.type, c.rot, c.x, c.y);
    this.app.changed();
  }

  duplicateSelection() {
    const sel = this.app.sel;
    if (!sel || sel.kind !== 'comp') return;
    this.app.checkpoint();
    const src = this.comp(sel.id);
    const c = this.addComponent(src.type, src.x + 30, src.y + 30);
    c.value = src.value; c.rot = src.rot; c.props = Object.assign({}, src.props);
    [c.x, c.y] = AK.snapPos(c.type, c.rot, c.x, c.y);
    this.app.select({ kind: 'comp', id: c.id });
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

    svg.addEventListener('contextmenu', e => { e.preventDefault(); this.cancel(); });

    svg.addEventListener('pointerdown', e => {
      const [wx, wy] = this.toWorld(e);
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
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
      if (compEl) {
        const c = this.comp(compEl.dataset.id);
        this.app.select({ kind: 'comp', id: c.id });
        this.drag = { id: c.id, ox: wx - c.x, oy: wy - c.y, moved: false };
        if (AK.LIB[c.type].board) {
          // плата едет вместе со вставленными в неё компонентами и перемычками
          const pk = o => Object.keys(AK.LIB[o.type].visual.pins).map(p => AK.pinWorld(o, p).map(Math.round).join(','));
          const holes = new Set(pk(c));
          const carry = this.P.components.filter(o => !AK.LIB[o.type].board && pk(o).some(s => holes.has(s)));
          const ids = new Set([c.id, ...carry.map(o => o.id)]);
          this.drag.carry = carry;
          this.drag.wires = this.P.wires.filter(w => ids.has(w.from.c) && ids.has(w.to.c));
        }
        svg.setPointerCapture(e.pointerId);
        this.render();
        return;
      }

      this.app.select(null);
      this.render();
      this.pan = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      svg.setPointerCapture(e.pointerId);
    });

    svg.addEventListener('pointermove', e => {
      const [wx, wy] = this.toWorld(e);
      if (this.pan) {
        this.view.x = this.pan.vx + e.clientX - this.pan.x;
        this.view.y = this.pan.vy + e.clientY - this.pan.y;
        this.applyView();
        return;
      }
      if (this.drag) {
        const c = this.comp(this.drag.id);
        const [nx, ny] = AK.snapPos(c.type, c.rot, wx - this.drag.ox, wy - this.drag.oy);
        if (nx !== c.x || ny !== c.y) {
          if (!this.drag.moved) { this.app.checkpoint(); this.drag.moved = true; }
          const dx = nx - c.x, dy = ny - c.y;
          c.x = nx; c.y = ny;
          if (this.drag.carry) {
            this.drag.carry.forEach(o => { o.x += dx; o.y += dy; });
            this.drag.wires.forEach(w => { w.points = w.points.map(([x, y]) => [x + dx, y + dy]); });
          }
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
