// Вид «Плата»: контур, посадочные места, линии связей. Детали можно двигать и поворачивать.
window.AK = window.AK || {};

AK.PcbView = class {
  constructor(svg, app) {
    this.svg = svg; this.app = app;
    this.view = { x: 60, y: 60, z: 10 }; // z — пикселей на мм
    svg.innerHTML = `<defs><pattern id="pcbgrid" width="2.54" height="2.54" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".09" fill="#5b6470"/></pattern></defs>` +
      `<g class="root"><rect class="bg" x="-1000" y="-1000" width="2000" height="2000" fill="url(#pcbgrid)"/><g class="content"></g><g class="temp"></g></g>`;
    this.root = svg.querySelector('.root');
    this.content = svg.querySelector('.content');
    this.bind();
  }

  get P() { return this.app.project; }
  toWorld(e) {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left - this.view.x) / this.view.z, (e.clientY - r.top - this.view.y) / this.view.z];
  }
  applyView() { this.root.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.z})`); }
  zoomBy(f, cx, cy) {
    const r = this.svg.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const nz = Math.max(2, Math.min(80, this.view.z * f));
    this.view.x = cx - (cx - this.view.x) * nz / this.view.z;
    this.view.y = cy - (cy - this.view.y) * nz / this.view.z;
    this.view.z = nz;
    this.applyView();
  }
  fit() {
    const r = this.svg.getBoundingClientRect();
    if (!r.width) return;
    const ol = AK.PCB.outline(this.P);
    let x1 = Math.min(...ol.map(p => p[0])), y1 = Math.min(...ol.map(p => p[1])), x2 = Math.max(...ol.map(p => p[0])), y2 = Math.max(...ol.map(p => p[1]));
    const b = AK.PCB.partsBBox(this.P);
    if (b) { x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); }
    const z = Math.min(r.width / (x2 - x1 + 12), r.height / (y2 - y1 + 12), 40);
    this.view = { z, x: r.width / 2 - (x1 + x2) / 2 * z, y: r.height / 2 - (y1 + y2) / 2 * z };
    this.applyView();
  }

  render() {
    const P = this.P, nl = this.app.netlist(), e = AK.util.esc;
    const pcb = AK.PCB.ensure(P);
    const ol = AK.PCB.outline(P);
    const [, fill] = AK.PCB.COLORS[pcb.color] || AK.PCB.COLORS.green;
    const silk = pcb.color === 'white' ? '#222' : '#f2f2f2';
    const sel = new Set(this.app.editor.selIds());
    let s = `<polygon class="pcb-board" points="${ol.map(p => p.join(',')).join(' ')}" fill="${fill}" stroke="#e8d44d" stroke-width=".25"/>`;
    const all = AK.PCB.pads(P, nl);
    this.padsCache = all;
    // детали
    P.components.forEach(c => {
      const part = pcb.parts[c.id], fp = AK.PCB.footprint(c);
      if (!part || !fp) return;
      const isSel = sel.has(c.id);
      s += `<g class="pcb-part${isSel ? ' sel' : ''}" data-id="${c.id}" transform="translate(${part.x} ${part.y}) rotate(${part.rot || 0})">`;
      const [x1, y1, x2, y2] = fp.crt;
      s += `<rect class="pcb-hit" x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="transparent"/>`;
      fp.silk.forEach(l => { s += `<polyline points="${l.p.map(p => p.join(',')).join(' ')}" fill="none" stroke="${silk}" stroke-width="${Math.max(0.12, l.w)}" stroke-linecap="round" stroke-linejoin="round"/>`; });
      s += '</g>';
    });
    // площадки — поверх шелкографии
    all.forEach(pp => {
      const p = pp.p;
      const tr = `translate(${AK.util.fmt(pp.x, 3)} ${AK.util.fmt(pp.y, 3)}) rotate(${pp.a})`;
      const k = pp.c.id + ':' + (pp.pin || '');
      if (p.k === 'np_thru_hole') {
        s += `<circle cx="${pp.x}" cy="${pp.y}" r="${(Array.isArray(p.d) ? p.d[0] : p.d) / 2}" fill="#14161a"/>`;
        return;
      }
      const rx = p.sh === 'circle' || p.sh === 'oval' ? Math.min(p.w, p.h) / 2 : p.sh === 'roundrect' ? Math.min(p.w, p.h) * (p.rr || 0.25) : 0;
      const col = p.k === 'smd' ? '#c9a640' : '#d4af37';
      s += `<g class="pcb-pad" data-k="${e(k)}" data-net="${e(pp.net)}" data-ref="${e(pp.c.ref)}" data-n="${e(p.n)}" transform="${tr}">` +
        `<rect x="${-p.w / 2}" y="${-p.h / 2}" width="${p.w}" height="${p.h}" rx="${rx}" fill="${col}"/>`;
      if (p.d) {
        if (Array.isArray(p.d)) s += `<rect x="${-p.d[0] / 2}" y="${-p.d[1] / 2}" width="${p.d[0]}" height="${p.d[1]}" rx="${Math.min(p.d[0], p.d[1]) / 2}" fill="#14161a"/>`;
        else s += `<circle r="${p.d / 2}" fill="#14161a"/>`;
      }
      s += '</g>';
    });
    // обозначения
    P.components.forEach(c => {
      const part = pcb.parts[c.id], fp = AK.PCB.footprint(c);
      if (!part || !fp) return;
      const b = AK.PCB.partBox(c, part);
      s += `<text class="pcb-ref" x="${(b.x1 + b.x2) / 2}" y="${b.y1 - 0.5}" fill="${silk}">${e(c.ref)}</text>`;
      if (sel.has(c.id)) s += `<rect class="pcb-selbox" x="${b.x1 - 0.4}" y="${b.y1 - 0.4}" width="${b.x2 - b.x1 + 0.8}" height="${b.y2 - b.y1 + 0.8}"/>`;
    });
    (pcb.texts || []).forEach(t => { s += `<text class="pcb-text" x="${t.x}" y="${t.y}" font-size="${t.size || 1.2}" fill="${silk}" opacity="${t.bottom ? 0.45 : 1}" transform="rotate(${t.rot || 0} ${t.x} ${t.y})">${e(t.text)}</text>`; });
    // линии связей
    const rats = AK.PCB.ratsnest(all);
    this.rats = rats;
    s += rats.map(r => `<line class="pcb-rat" x1="${r.a.x}" y1="${r.a.y}" x2="${r.b.x}" y2="${r.b.y}"/>`).join('');
    this.content.innerHTML = s;
    this.applyView();
  }

  bind() {
    const svg = this.svg;
    const grid = e => (e.altKey ? 0.1 : 0.5);
    const snap = (v, g) => Math.round(v / g) * g;
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    svg.addEventListener('contextmenu', e => e.preventDefault());
    svg.addEventListener('pointerdown', e => {
      const [wx, wy] = this.toWorld(e);
      const partEl = e.target.closest('.pcb-part') || (e.target.closest('.pcb-pad') && this.partAt(wx, wy));
      if (e.button === 0 && partEl) {
        const id = partEl.dataset ? partEl.dataset.id : partEl;
        const part = this.P.pcb.parts[id];
        this.app.selectComp(id);
        // привязка к сетке — по смещению: точная расстановка (например, под углом) не сбивается
        this.drag = { id, wx, wy, x0: part.x, y0: part.y, moved: false };
        svg.setPointerCapture(e.pointerId);
        this.render();
        return;
      }
      if (e.button === 0) { this.app.select(null); this.render(); }
      this.pan = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (this.pan) {
        this.view.x = this.pan.vx + e.clientX - this.pan.x;
        this.view.y = this.pan.vy + e.clientY - this.pan.y;
        this.applyView();
        return;
      }
      if (this.drag) {
        const [wx, wy] = this.toWorld(e);
        const part = this.P.pcb.parts[this.drag.id];
        const g = grid(e);
        const nx = +(this.drag.x0 + snap(wx - this.drag.wx, g)).toFixed(3), ny = +(this.drag.y0 + snap(wy - this.drag.wy, g)).toFixed(3);
        if (nx !== part.x || ny !== part.y) {
          if (!this.drag.moved) { this.app.checkpoint(); this.drag.moved = true; }
          part.x = nx; part.y = ny;
          this.render();
        }
        return;
      }
      const pad = e.target.closest && e.target.closest('.pcb-pad');
      if (pad) this.app.tooltip(`<b>${AK.util.esc(pad.dataset.ref)}</b> · площадка ${AK.util.esc(pad.dataset.n)}` + (pad.dataset.net ? `<br>цепь <b>${AK.util.esc(pad.dataset.net)}</b>` : '<br><i>не подключена</i>'), e);
      else this.app.tooltip(null);
    });
    const up = () => {
      const moved = this.drag && this.drag.moved;
      this.drag = null; this.pan = null;
      if (moved) { this.app.save(); this.app.renderInspector(); }
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', () => this.app.tooltip(null));
  }

  // деталь под точкой (для клика по площадке)
  partAt(wx, wy) {
    const P = this.P;
    const c = P.components.find(c => { const part = P.pcb.parts[c.id]; if (!part || !AK.PCB.footprint(c)) return false; const b = AK.PCB.partBox(c, part); return wx >= b.x1 && wx <= b.x2 && wy >= b.y1 && wy <= b.y2; });
    return c ? c.id : null;
  }

  rotateSel(deg) {
    const ids = this.app.editor.selIds().filter(id => this.P.pcb.parts[id]);
    if (!ids.length) return;
    this.app.checkpoint();
    ids.forEach(id => { const p = this.P.pcb.parts[id]; p.rot = (((p.rot || 0) + deg) % 360 + 360) % 360; });
    this.app.save(); this.render(); this.app.renderInspector();
  }
  nudge(dx, dy) {
    const ids = this.app.editor.selIds().filter(id => this.P.pcb.parts[id]);
    if (!ids.length) return;
    this.app.checkpoint();
    ids.forEach(id => { const p = this.P.pcb.parts[id]; p.x = +(p.x + dx).toFixed(3); p.y = +(p.y + dy).toFixed(3); });
    this.app.save(); this.render(); this.app.renderInspector();
  }
};
