// Отрисовка модели схемы в SVG (единицы U) и интерактивный просмотр
window.AK = window.AK || {};

AK.DIRV = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] }; // от точки подключения к корпусу

AK.SCH_STYLE = `
.s-body{stroke:#a3242c;stroke-width:.09;fill:none;stroke-linecap:round;stroke-linejoin:round}
.s-fill{fill:#fff6d5}
.s-solid{fill:#a3242c}
.s-pin{stroke:#a3242c;stroke-width:.07}
.s-wire{stroke:#0b8a3e;stroke-width:.08;stroke-linecap:round}
.s-junc{fill:#0b8a3e}
.s-nc{stroke:#2a6fdb;stroke-width:.07}
.s-pwr{stroke:#a3242c;stroke-width:.08;fill:none}
.s-ref{fill:#0f5c8c;font-size:.62px;font-family:Arial,sans-serif}
.s-val{fill:#3a3a3a;font-size:.55px;font-family:Arial,sans-serif}
.s-pinname{fill:#7a1b20;font-size:.5px;font-family:Arial,sans-serif}
.s-pinnum{fill:#888;font-size:.38px;font-family:Arial,sans-serif}
.s-label{fill:#1b5e20;font-size:.6px;font-family:Arial,sans-serif;font-weight:bold}
.s-pwrtext{fill:#a3242c;font-size:.55px;font-family:Arial,sans-serif;font-weight:bold}
.s-gtext{fill:#a3242c;font-family:Arial,sans-serif}
`;

AK.symbolSVG = function (def, comp, showText) {
  const s = def.sym, e = AK.util.esc;
  let out = '';
  s.gfx.forEach(g => {
    const w = g.w ? ` style="stroke-width:${0.09 * g.w}"` : '';
    if (g.t === 'line') out += `<polyline class="s-body" points="${g.pts.map(p => p.join(',')).join(' ')}"${w}/>`;
    else if (g.t === 'rect') out += `<rect class="s-body ${g.fill === 'body' ? 's-fill' : ''}" x="${g.x1}" y="${g.y1}" width="${g.x2 - g.x1}" height="${g.y2 - g.y1}"/>`;
    else if (g.t === 'circle') out += `<circle class="s-body" cx="${g.cx}" cy="${g.cy}" r="${g.r}"/>`;
    else if (g.t === 'poly') out += `<polygon class="s-body s-solid" points="${g.pts.map(p => p.join(',')).join(' ')}"/>`;
    else if (g.t === 'text') out += `<text class="s-gtext" x="${g.x}" y="${g.y}" font-size="${g.size}" text-anchor="middle" dominant-baseline="central">${e(g.text)}</text>`;
  });
  Object.entries(s.pins).forEach(([num, p]) => {
    const [dx, dy] = AK.DIRV[p.dir];
    const ex = p.x + dx * p.len, ey = p.y + dy * p.len;
    out += `<line class="s-pin" x1="${p.x}" y1="${p.y}" x2="${ex}" y2="${ey}"/>`;
    if (s.showNames && p.name) {
      const anchor = p.dir === 'R' ? 'start' : 'end';
      out += `<text class="s-pinname" x="${ex + dx * 0.25}" y="${ey}" text-anchor="${anchor}" dominant-baseline="central">${e(p.name)}</text>`;
    }
    if (s.showNums) {
      out += `<text class="s-pinnum" x="${(p.x + ex) / 2}" y="${p.y - 0.12}" text-anchor="middle">${e(num)}</text>`;
    }
  });
  if (showText !== false && comp) {
    out += `<text class="s-ref" x="${s.ref[0]}" y="${s.ref[1]}" text-anchor="${s.ref[2]}" dominant-baseline="central">${e(comp.ref)}</text>`;
    if (comp.value && comp.value !== comp.ref)
      out += `<text class="s-val" x="${s.val[0]}" y="${s.val[1]}" text-anchor="${s.val[2]}" dominant-baseline="central">${e(comp.value)}</text>`;
  }
  return out;
};

AK.powerSVG = function (p) {
  const { x, y } = p, e = AK.util.esc;
  if (p.kind === 'gnd') {
    return `<path class="s-pwr" d="M${x} ${y}V${y + 0.5}M${x - 0.6} ${y + 0.5}H${x + 0.6}M${x - 0.37} ${y + 0.75}H${x + 0.37}M${x - 0.14} ${y + 1}H${x + 0.14}"/>` +
      (p.name !== 'GND' ? `<text class="s-pwrtext" x="${x}" y="${y + 1.55}" text-anchor="middle">${e(p.name)}</text>` : '');
  }
  return `<path class="s-pwr" d="M${x} ${y}V${y - 0.6}M${x - 0.5} ${y - 0.6}H${x + 0.5}"/>` +
    `<text class="s-pwrtext" x="${x}" y="${y - 0.85}" text-anchor="middle">${e(p.name)}</text>`;
};

AK.labelSVG = function (l) {
  const e = AK.util.esc, o = 0.12;
  if (l.dir === 'R') return `<text class="s-label" x="${l.x + o}" y="${l.y - o}" text-anchor="start">${e(l.text)}</text>`;
  if (l.dir === 'L') return `<text class="s-label" x="${l.x - o}" y="${l.y - o}" text-anchor="end">${e(l.text)}</text>`;
  if (l.dir === 'U') return `<text class="s-label" x="${l.x - o}" y="${l.y - o}" text-anchor="start" transform="rotate(-90 ${l.x - o} ${l.y - o})">${e(l.text)}</text>`;
  return `<text class="s-label" x="${l.x - o}" y="${l.y + o}" text-anchor="end" transform="rotate(-90 ${l.x - o} ${l.y + o})">${e(l.text)}</text>`;
};

AK.schematicSVG = function (m, opts) {
  opts = opts || {};
  let s = '';
  m.wires.forEach(w => { s += `<line class="s-wire" data-net="${w.net}" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}"/>`; });
  m.junctions.forEach(([x, y]) => { s += `<circle class="s-junc" cx="${x}" cy="${y}" r=".17"/>`; });
  m.ncs.forEach(([x, y]) => { s += `<path class="s-nc" d="M${x - 0.3} ${y - 0.3}L${x + 0.3} ${y + 0.3}M${x + 0.3} ${y - 0.3}L${x - 0.3} ${y + 0.3}"/>`; });
  m.power.forEach(p => { s += AK.powerSVG(p); });
  m.labels.forEach(l => { s += AK.labelSVG(l); });
  m.symbols.forEach(sy => {
    const b = sy.def.sym.bbox;
    s += `<g class="sym" data-id="${sy.comp.id}" transform="translate(${sy.x} ${sy.y})">` +
      `<rect class="sym-hit" x="${b.x1 - 0.3}" y="${b.y1 - 0.3}" width="${b.x2 - b.x1 + 0.6}" height="${b.y2 - b.y1 + 0.6}" fill="transparent"/>` +
      AK.symbolSVG(sy.def, sy.comp) + `</g>`;
  });
  return s;
};

AK.schematicStandaloneSVG = function (m, title) {
  const pad = 2, b = m.bbox;
  const w = b.x2 - b.x1 + pad * 2, h = b.y2 - b.y1 + pad * 2;
  const px = 40;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w * px}" height="${h * px}" viewBox="${b.x1 - pad} ${b.y1 - pad} ${w} ${h}">` +
    `<title>${AK.util.esc(title || 'Схема')}</title><style>${AK.SCH_STYLE}</style>` +
    `<rect x="${b.x1 - pad}" y="${b.y1 - pad}" width="${w}" height="${h}" fill="#fff"/>${AK.schematicSVG(m)}</svg>`;
};

AK.SchView = class {
  constructor(svg, app) {
    this.svg = svg; this.app = app;
    this.view = { x: 60, y: 60, z: 34 };
    this.model = null;
    svg.innerHTML = `<defs><pattern id="schgrid" width="1" height="1" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".045" fill="#c4c9d1"/></pattern><style>${AK.SCH_STYLE}</style></defs>` +
      `<g class="root"><rect class="bg" x="-500" y="-500" width="1000" height="1000" fill="url(#schgrid)"/><g class="content"></g></g>`;
    this.root = svg.querySelector('.root');
    this.content = svg.querySelector('.content');
    this.bind();
  }

  toWorld(e) {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left - this.view.x) / this.view.z, (e.clientY - r.top - this.view.y) / this.view.z];
  }
  applyView() { this.root.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.z})`); }

  render(model) {
    this.model = model;
    this.content.innerHTML = AK.schematicSVG(model);
    this.applyView();
  }

  fit() {
    if (!this.model) return;
    const b = this.model.bbox, r = this.svg.getBoundingClientRect();
    if (!r.width) return;
    const z = Math.min(r.width / (b.x2 - b.x1 + 6), r.height / (b.y2 - b.y1 + 6), 60);
    this.view.z = z;
    this.view.x = r.width / 2 - (b.x1 + b.x2) / 2 * z;
    this.view.y = r.height / 2 - (b.y1 + b.y2) / 2 * z;
    this.applyView();
  }

  zoomBy(f, cx, cy) {
    const r = this.svg.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const nz = Math.max(4, Math.min(200, this.view.z * f));
    this.view.x = cx - (cx - this.view.x) * nz / this.view.z;
    this.view.y = cy - (cy - this.view.y) * nz / this.view.z;
    this.view.z = nz;
    this.applyView();
  }

  bind() {
    const svg = this.svg;
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.button !== 1) return;
      const g = e.target.closest('.sym');
      svg.setPointerCapture(e.pointerId);
      if (g && e.button === 0) {
        const sy = this.model.symbols.find(s => s.comp.id === g.dataset.id);
        const [wx, wy] = this.toWorld(e);
        this.drag = { sy, g, dx: wx - sy.x, dy: wy - sy.y, moved: false };
        this.app.selectComp(sy.comp.id);
        this.content.querySelectorAll('.sym.sel').forEach(n => n.classList.remove('sel'));
        g.classList.add('sel');
      } else {
        this.pan = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      }
    });
    svg.addEventListener('pointermove', e => {
      if (this.drag) {
        const [wx, wy] = this.toWorld(e);
        const nx = Math.round(wx - this.drag.dx), ny = Math.round(wy - this.drag.dy);
        if (nx !== this.drag.sy.x || ny !== this.drag.sy.y) {
          this.drag.moved = true;
          this.drag.sy.x = nx; this.drag.sy.y = ny;
          this.drag.g.setAttribute('transform', `translate(${nx} ${ny})`);
          this.content.classList.add('dragging');
        }
      } else if (this.pan) {
        this.view.x = this.pan.vx + e.clientX - this.pan.x;
        this.view.y = this.pan.vy + e.clientY - this.pan.y;
        this.applyView();
      }
    });
    const up = () => {
      if (this.drag && this.drag.moved) {
        // фиксируем текущее расположение всех символов и перестраиваем провода
        this.app.checkpoint();
        this.model.symbols.forEach(s => { s.comp.sch = { x: s.x, y: s.y }; });
        this.content.classList.remove('dragging');
        this.app.changed({ keepView: true, schOnly: true });
      }
      this.drag = null; this.pan = null;
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  }
};
