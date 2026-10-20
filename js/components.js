// Библиотека компонентов.
// visual — как компонент выглядит в режиме «Монтаж» (пиксели, 10px = 0.1").
// sym    — символ для принципиальной схемы (единицы U = 100 mil = 2.54 мм, ось Y вниз).
//          dir вывода — направление от точки подключения к корпусу (R/L/U/D).
window.AK = window.AK || {};

AK.symBBox = function (sym) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
  sym.gfx.forEach(g => {
    if (g.pts) g.pts.forEach(p => add(p[0], p[1]));
    if (g.t === 'rect') { add(g.x1, g.y1); add(g.x2, g.y2); }
    if (g.t === 'circle') { add(g.cx - g.r, g.cy - g.r); add(g.cx + g.r, g.cy + g.r); }
  });
  Object.values(sym.pins).forEach(p => add(p.x, p.y));
  return { x1, y1, x2, y2 };
};

AK.LIB = (function () {
  const BAND = ['#1a1a1a', '#7a4a1e', '#d42020', '#f07c1a', '#f2d11b', '#2e9c3a', '#2457c5', '#7d3cb5', '#8a8a8a', '#f4f4f4'];
  const LED_COLORS = { red: '#e53935', green: '#43a047', blue: '#1e88e5', yellow: '#fdd835', white: '#f2f2f2', orange: '#fb8c00' };
  const LED_NAMES = { red: 'Красный', green: 'Зелёный', blue: 'Синий', yellow: 'Жёлтый', white: 'Белый', orange: 'Оранжевый' };

  const leg = (x1, y1, x2, y2) => `<line class="leg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const txt = (x, y, s, size, fill, extra) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="middle" dominant-baseline="central" ${extra || ''}>${AK.util.esc(s)}</text>`;

  function resistorBands(value) {
    const ohms = AK.util.parseValue(value);
    if (!(ohms > 0)) return [BAND[0], BAND[0], BAND[0]];
    let exp = Math.floor(Math.log10(ohms)) - 1;
    let sig = Math.round(ohms / Math.pow(10, exp));
    if (sig >= 100) { sig = 10; exp++; }
    const mult = exp >= 0 ? BAND[Math.min(exp, 9)] : (exp === -1 ? '#c9a227' : '#b8b8b8');
    return [BAND[Math.floor(sig / 10)], BAND[sig % 10], mult];
  }

  function capCode(value) {
    const f = AK.util.parseValue(value);
    if (!(f > 0)) return '?';
    const pf = Math.round(f * 1e12);
    if (pf < 100) return String(pf);
    const exp = Math.floor(Math.log10(pf)) - 1;
    return String(Math.round(pf / Math.pow(10, exp))) + exp;
  }

  // ---------- примитивы символов ----------
  const L = (...pts) => ({ t: 'line', pts });
  const RECT = (x1, y1, x2, y2, fill) => ({ t: 'rect', x1, y1, x2, y2, fill: fill || 'none' });
  const CIRC = (cx, cy, r, fill) => ({ t: 'circle', cx, cy, r, fill: fill || 'none' });
  const POLY = (...pts) => ({ t: 'poly', pts });
  const TXT = (x, y, text, size) => ({ t: 'text', x, y, text, size: size || 0.6 });
  const pin = (x, y, dir, len, extra) => Object.assign({ x, y, dir, len }, extra || {});

  function arc(cx, cy, r, a1, a2, n) {
    const pts = [];
    n = n || 8;
    for (let i = 0; i <= n; i++) {
      const a = (a1 + (a2 - a1) * i / n) * Math.PI / 180;
      pts.push([+(cx + r * Math.cos(a)).toFixed(3), +(cy + r * Math.sin(a)).toFixed(3)]);
    }
    return pts;
  }

  function arrowHead(x1, y1, x2, y2, size) {
    const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy);
    const ux = dx / l, uy = dy / l, s = size || 0.3;
    const bx = x2 - ux * s, by = y2 - uy * s;
    return POLY([x2, y2], [+(bx - uy * s * 0.5).toFixed(3), +(by + ux * s * 0.5).toFixed(3)], [+(bx + uy * s * 0.5).toFixed(3), +(by - ux * s * 0.5).toFixed(3)]);
  }

  // Прямоугольный символ микросхемы: left/right — списки [номер, имя, тип]
  function makeIC(left, right, width) {
    const rows = Math.max(left.length, right.length);
    const hw = width / 2;
    const pins = {};
    left.forEach(([num, name, type], i) => { pins[num] = pin(-hw - 1, i, 'R', 1, { name, type }); });
    right.forEach(([num, name, type], i) => { pins[num] = pin(hw + 1, i, 'L', 1, { name, type }); });
    return {
      ic: true,
      gfx: [RECT(-hw, -1, hw, rows, 'body')],
      pins,
      ref: [-hw, -1.6, 'start'],
      val: [-hw, rows + 0.7, 'start'],
      showNames: true,
      showNums: true,
    };
  }

  const defs = {};

  // ---------- макетная плата: отверстия в одной полоске соединены, как у настоящей ----------
  const BB_ROWS = { a: -50, b: -40, c: -30, d: -20, e: -10, f: 20, g: 30, h: 40, i: 50, j: 60 };
  const BB_RAILS = [['TP', -90, '+', 'верх'], ['TN', -80, '−', 'верх'], ['BN', 90, '−', 'низ'], ['BP', 100, '+', 'низ']];
  // макетная плата на cols столбцов (half-size — 30, full-size — 60)
  function breadboard(cols, name) {
    const mid = cols / 2;
    const bbX = i => (i - mid) * 10;
    const x1 = bbX(1) - 20, x2 = bbX(cols) + 20, W = x2 - x1;
    const bbPins = {}, bbNames = {}, bbGroups = [];
    for (let i = 1; i <= cols; i++) {
      ['abcde', 'fghij'].forEach(rows => {
        const g = [];
        for (const r of rows) { bbPins[r + i] = [bbX(i), BB_ROWS[r]]; g.push(r + i); }
        bbGroups.push(g);
      });
    }
    BB_RAILS.forEach(([id, y, sign, side]) => {
      const g = [];
      for (let i = 1; i <= cols; i++) {
        if (i % 6 === 0) continue; // отверстия шины идут группами по 5
        bbPins[id + i] = [bbX(i), y];
        bbNames[id + i] = `шина ${sign} (${side})`;
        g.push(id + i);
      }
      bbGroups.push(g);
    });
    return {
      name, prefix: 'BB', cat: 'Макетная плата', value: '', virtual: true, board: true,
      pinNames: bbNames, groups: bbGroups,
      visual: {
        box: [x1, -105, W, 220],
        pins: bbPins,
        // st.on — занятые отверстия (в них ножка или провод)
        draw(c, st) {
          const on = st && st.on;
          let s = `<rect x="${x1}" y="-105" width="${W}" height="220" rx="6" fill="#f4f2ec" stroke="#cdc6b4"/>` +
            `<rect x="${x1 + 4}" y="1" width="${W - 8}" height="8" rx="2" fill="#e2dccb"/>`;
          [[-97, '#d32f2f'], [-73, '#1e66c8'], [83, '#1e66c8'], [107, '#d32f2f']].forEach(([y, col]) => {
            s += `<line x1="${x1 + 15}" y1="${y}" x2="${x2 - 15}" y2="${y}" stroke="${col}" stroke-width="1.2"/>`;
          });
          for (let i = 1; i <= cols; i++) if (i === 1 || i % 5 === 0) s += txt(bbX(i), -62, i, 5, '#9a9282') + txt(bbX(i), 72, i, 5, '#9a9282');
          Object.entries(BB_ROWS).forEach(([r, y]) => { s += txt(x1 + 8, y, r, 5, '#9a9282') + txt(x2 - 8, y, r, 5, '#9a9282'); });
          BB_RAILS.forEach(([, y, sign]) => {
            const col = sign === '+' ? '#d32f2f' : '#1e66c8';
            s += txt(x1 + 8, y, sign, 8, col, 'font-weight="700"') + txt(x2 - 8, y, sign, 8, col, 'font-weight="700"');
          });
          Object.entries(bbPins).forEach(([p, [x, y]]) => {
            if (c.id) s += `<circle class="pin hole${on && on.has(c.id + ':' + p) ? ' on' : ''}" data-k="${c.id}:${p}" cx="${x}" cy="${y}" r="2.6"/>`;
            else s += `<rect x="${x - 2}" y="${y - 2}" width="4" height="4" fill="#4a4e54"/>`;
          });
          return s;
        },
      },
    };
  }
  defs.breadboard = breadboard(30, 'Макетная плата');
  defs.breadboard_full = breadboard(60, 'Макетная плата (большая)');

  defs.resistor = {
    name: 'Резистор', prefix: 'R', cat: 'Пассивные', value: '10k', kicadName: 'R',
    footprint: 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal', eePackage: 'AXIAL-0.4',
    fpAlt: ['Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal', 'Resistor_THT:R_Axial_DIN0204_L3.6mm_D1.6mm_P7.62mm_Horizontal', 'Resistor_THT:R_Axial_DIN0204_L3.6mm_D1.6mm_P2.54mm_Vertical', 'Resistor_SMD:R_0805_2012Metric', 'Resistor_SMD:R_0603_1608Metric'],
    visual: {
      box: [-30, -8, 60, 16],
      hit: [-18, -8, 36, 16], // область захвата — только корпус, отверстия у ножек остаются доступны
      pins: { 1: [-30, 0], 2: [30, 0] },
      draw(c) {
        const b = resistorBands(c.value);
        return leg(-30, 0, -16, 0) + leg(16, 0, 30, 0) +
          `<rect x="-18" y="-6.5" width="36" height="13" rx="6" fill="#e3c48f" stroke="#a8885a" stroke-width="1"/>` +
          `<rect x="-12" y="-6.5" width="3.5" height="13" fill="${b[0]}"/>` +
          `<rect x="-6" y="-6.5" width="3.5" height="13" fill="${b[1]}"/>` +
          `<rect x="0" y="-6.5" width="3.5" height="13" fill="${b[2]}"/>` +
          `<rect x="9" y="-6.5" width="3" height="13" fill="#c9a227"/>`;
      },
    },
    sym: {
      gfx: [RECT(-1, -0.4, 1, 0.4)],
      pins: { 1: pin(-2, 0, 'R', 1), 2: pin(2, 0, 'L', 1) },
      ref: [0, -1, 'middle'], val: [0, 1.1, 'middle'],
    },
  };

  defs.capacitor = {
    name: 'Конденсатор', prefix: 'C', cat: 'Пассивные', value: '100n', kicadName: 'C',
    footprint: 'Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm', eePackage: 'CAP-D5.0',
    fpAlt: ['Capacitor_THT:C_Disc_D3.0mm_W1.6mm_P2.50mm', 'Capacitor_SMD:C_0805_2012Metric', 'Capacitor_SMD:C_0603_1608Metric'],
    visual: {
      box: [-15, -16, 30, 36],
      hit: [-15, -16, 30, 24], // область захвата — только корпус, отверстия у ножек остаются доступны
      pins: { 1: [-10, 20], 2: [10, 20] },
      draw(c) {
        return leg(-10, 20, -6, 4) + leg(10, 20, 6, 4) +
          `<ellipse cx="0" cy="-4" rx="14" ry="11" fill="#f0a43a" stroke="#b97616"/>` +
          txt(0, -4, capCode(c.value), 7, '#5a3500', 'font-weight="600"');
      },
    },
    sym: {
      gfx: [L([-0.2, -0.8], [-0.2, 0.8]), L([0.2, -0.8], [0.2, 0.8])],
      pins: { 1: pin(-1, 0, 'R', 0.8), 2: pin(1, 0, 'L', 0.8) },
      ref: [0, -1.3, 'middle'], val: [0, 1.4, 'middle'],
    },
  };

  defs.electrolytic = {
    name: 'Электролит. конденсатор', prefix: 'C', cat: 'Пассивные', value: '10u', kicadName: 'CP',
    footprint: 'Capacitor_THT:CP_Radial_D5.0mm_P2.00mm', eePackage: 'CAP-TH_BD5.0-P2.00',
    fpAlt: ['Capacitor_THT:CP_Radial_D6.3mm_P2.50mm', 'Capacitor_THT:CP_Radial_D8.0mm_P3.50mm', 'Capacitor_SMD:CP_Elec_5x5.4'],
    pinNames: { 1: '+', 2: '−' },
    visual: {
      box: [-14, -31, 28, 51],
      hit: [-14, -31, 28, 38], // область захвата — только корпус, отверстия у ножек остаются доступны
      pins: { 1: [-10, 20], 2: [10, 20] },
      draw(c) {
        return leg(-10, 6, -10, 20) + leg(10, 6, 10, 20) +
          `<rect x="-13" y="-30" width="26" height="36" rx="4" fill="#1f3f8a" stroke="#122656"/>` +
          `<rect x="5" y="-30" width="6" height="36" fill="#c9d3e6"/>` +
          txt(8, -12, '−', 8, '#1f3f8a', 'font-weight="700"') +
          txt(-4, -12, c.value + 'F', 6, '#fff', 'transform="rotate(-90 -4 -12)"');
      },
    },
    sym: {
      gfx: [L([-0.2, -0.8], [-0.2, 0.8]), L(...arc(1.2, 0, 1.1, 145, 215)), TXT(-0.65, -0.6, '+', 0.7)],
      pins: { 1: pin(-1, 0, 'R', 0.8), 2: pin(1, 0, 'L', 0.9) },
      ref: [0, -1.3, 'middle'], val: [0, 1.4, 'middle'],
    },
  };

  defs.led = {
    name: 'Светодиод', prefix: 'D', cat: 'Полупроводники', value: 'LED', kicadName: 'LED',
    footprint: 'LED_THT:LED_D5.0mm', eePackage: 'LED-TH-5MM',
    fpAlt: ['LED_THT:LED_D3.0mm', 'LED_SMD:LED_0805_2012Metric', 'LED_SMD:LED_1206_3216Metric'],
    pinNames: { 1: 'K', 2: 'A' },
    props: [{ key: 'color', label: 'Цвет', options: LED_NAMES, def: 'red' }],
    visual: {
      box: [-14, -27, 28, 47],
      hit: [-13, -27, 26, 31], // область захвата — только корпус, отверстия у ножек остаются доступны
      pins: { 2: [-10, 20], 1: [10, 20] },
      draw(c) {
        const col = LED_COLORS[(c.props && c.props.color) || 'red'] || LED_COLORS.red;
        return leg(-6, 2, -10, 20) + leg(6, 2, 10, 20) +
          `<rect x="-13" y="-2" width="26" height="5" rx="2" fill="${col}" stroke="rgba(0,0,0,.35)"/>` +
          `<path d="M -11 -2 L -11 -14 A 11 11 0 0 1 11 -14 L 11 -2 Z" fill="${col}" fill-opacity=".92" stroke="rgba(0,0,0,.35)"/>` +
          `<ellipse cx="-4" cy="-15" rx="3" ry="5" fill="#fff" fill-opacity=".55"/>` +
          txt(-14, 13, '+', 8, '#c62828', 'font-weight="700"');
      },
    },
    sym: {
      gfx: [POLY([-0.5, -0.6], [0.5, 0], [-0.5, 0.6]), L([0.5, -0.6], [0.5, 0.6]), L([-0.5, 0], [0.5, 0]),
        L([0, -0.8], [0.5, -1.3]), arrowHead(0, -0.8, 0.5, -1.3, 0.25), L([0.4, -0.7], [0.9, -1.2]), arrowHead(0.4, -0.7, 0.9, -1.2, 0.25)],
      pins: { 2: pin(-2, 0, 'R', 1.5), 1: pin(2, 0, 'L', 1.5) },
      ref: [0, -1.8, 'middle'], val: [0, 1.2, 'middle'],
    },
  };

  defs.diode = {
    name: 'Диод', prefix: 'D', cat: 'Полупроводники', value: '1N4007', kicadName: 'D',
    footprint: 'Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal', eePackage: 'DO-41',
    fpAlt: ['Diode_THT:D_DO-41_SOD81_P7.62mm_Horizontal', 'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal', 'Diode_SMD:D_SMA'],
    pinNames: { 1: 'K', 2: 'A' },
    visual: {
      box: [-30, -7, 60, 14],
      hit: [-14, -7, 28, 14], // область захвата — только корпус, отверстия у ножек остаются доступны
      pins: { 2: [-30, 0], 1: [30, 0] },
      draw() {
        return leg(-30, 0, -14, 0) + leg(14, 0, 30, 0) +
          `<rect x="-14" y="-5" width="28" height="10" rx="2" fill="#222" stroke="#000"/>` +
          `<rect x="7" y="-5" width="4" height="10" fill="#cfcfcf"/>`;
      },
    },
    sym: {
      gfx: [POLY([-0.5, -0.6], [0.5, 0], [-0.5, 0.6]), L([0.5, -0.6], [0.5, 0.6]), L([-0.5, 0], [0.5, 0])],
      pins: { 2: pin(-2, 0, 'R', 1.5), 1: pin(2, 0, 'L', 1.5) },
      ref: [0, -1.1, 'middle'], val: [0, 1.2, 'middle'],
    },
  };

  defs.npn = {
    name: 'NPN транзистор', prefix: 'Q', cat: 'Полупроводники', value: 'BC547', kicadName: 'NPN',
    footprint: 'Package_TO_SOT_THT:TO-92_Inline', eePackage: 'TO-92',
    pinNames: { 1: 'C', 2: 'B', 3: 'E' },
    visual: {
      box: [-13, -23, 26, 43],
      hit: [-13, -23, 26, 28], // область захвата — только корпус, отверстия у ножек остаются доступны
      pins: { 1: [-10, 20], 2: [0, 20], 3: [10, 20] },
      draw(c) {
        return leg(-10, 4, -10, 20) + leg(0, 4, 0, 20) + leg(10, 4, 10, 20) +
          `<path d="M -12 4 L -12 -10 A 12 12 0 0 1 12 -10 L 12 4 Z" fill="#262626" stroke="#000"/>` +
          txt(0, -6, c.value, 5, '#ddd') + txt(-10, 26, 'C', 5, '#667') + txt(0, 26, 'B', 5, '#667') + txt(10, 26, 'E', 5, '#667');
      },
    },
    sym: {
      gfx: [CIRC(0.4, 0, 1.2), L([-0.4, -0.7], [-0.4, 0.7]), L([-0.4, -0.35], [1, -1]), L([-0.4, 0.35], [1, 1]), arrowHead(-0.4, 0.35, 0.75, 0.88, 0.35)],
      pins: { 1: pin(1, -2, 'D', 1), 2: pin(-2, 0, 'R', 1.6), 3: pin(1, 2, 'U', 1) },
      ref: [1.8, -0.3, 'start'], val: [1.8, 0.6, 'start'],
    },
  };

  // корпус TO-92: три ножки в ряд с шагом 0.1"
  function to92(c) {
    return leg(-10, 4, -10, 20) + leg(0, 4, 0, 20) + leg(10, 4, 10, 20) +
      `<path d="M -12 4 L -12 -10 A 12 12 0 0 1 12 -10 L 12 4 Z" fill="#262626" stroke="#000"/>` +
      txt(0, -6, c.value, 5, '#ddd');
  }
  const pinLabels = (names, y) => names.map((n, i) => txt(-10 + i * 10, y, n, 5, '#667')).join('');

  defs.pnp = {
    name: 'PNP транзистор', prefix: 'Q', cat: 'Полупроводники', value: 'BC557', kicadName: 'PNP',
    footprint: 'Package_TO_SOT_THT:TO-92_Inline', eePackage: 'TO-92',
    pinNames: { 1: 'C', 2: 'B', 3: 'E' },
    visual: {
      box: [-13, -23, 26, 43],
      hit: [-13, -23, 26, 28],
      pins: { 1: [-10, 20], 2: [0, 20], 3: [10, 20] },
      draw(c) { return to92(c) + pinLabels(['C', 'B', 'E'], 26); },
    },
    sym: {
      gfx: [CIRC(0.4, 0, 1.2), L([-0.4, -0.7], [-0.4, 0.7]), L([-0.4, -0.35], [1, -1]), L([-0.4, 0.35], [1, 1]), arrowHead(0.748, -0.883, 0.048, -0.558, 0.35)],
      pins: { 3: pin(1, -2, 'D', 1), 2: pin(-2, 0, 'R', 1.6), 1: pin(1, 2, 'U', 1) },
      ref: [1.8, -0.3, 'start'], val: [1.8, 0.6, 'start'],
    },
  };

  // корпус TO-220: металлический фланец сверху, три ножки с шагом 0.1"
  function to220(c) {
    return leg(-10, 2, -10, 20) + leg(0, 2, 0, 20) + leg(10, 2, 10, 20) +
      `<rect x="-15" y="-32" width="30" height="16" rx="1.5" fill="#b0b5ba" stroke="#7d848b"/>` +
      `<circle cx="0" cy="-25" r="3.6" fill="#f4f2ec" stroke="#7d848b"/>` +
      `<rect x="-15" y="-17" width="30" height="19" rx="1" fill="#262626" stroke="#000"/>` +
      txt(0, -8, c.value, 5, '#ddd');
  }

  defs.nmos = {
    name: 'N-MOSFET', prefix: 'Q', cat: 'Полупроводники', value: 'IRLZ44N', kicadName: 'NMOS',
    footprint: 'Package_TO_SOT_THT:TO-220-3_Vertical', eePackage: 'TO-220-3',
    pinNames: { 1: 'G', 2: 'D', 3: 'S' },
    visual: {
      box: [-15, -32, 30, 58],
      hit: [-15, -32, 30, 34],
      pins: { 1: [-10, 20], 2: [0, 20], 3: [10, 20] },
      draw(c) { return to220(c) + pinLabels(['G', 'D', 'S'], 26); },
    },
    sym: {
      gfx: [L([-0.4, -0.7], [-0.4, 0.7]), L([-0.1, -0.8], [-0.1, -0.4]), L([-0.1, -0.2], [-0.1, 0.2]), L([-0.1, 0.4], [-0.1, 0.8]),
        L([-0.1, -0.6], [1, -0.6], [1, -1]), L([-0.1, 0.6], [1, 0.6], [1, 1]), L([-0.1, 0], [1, 0], [1, 0.6]), arrowHead(0.5, 0, -0.05, 0, 0.35)],
      pins: { 2: pin(1, -2, 'D', 1), 1: pin(-2, 0, 'R', 1.6), 3: pin(1, 2, 'U', 1) },
      ref: [1.5, -0.3, 'start'], val: [1.5, 0.6, 'start'],
    },
  };

  defs.zener = {
    name: 'Стабилитрон', prefix: 'D', cat: 'Полупроводники', value: 'BZX55C5V1', kicadName: 'D_Zener',
    footprint: 'Diode_THT:D_DO-35_SOD27_P10.16mm_Horizontal', eePackage: 'DO-35',
    fpAlt: ['Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal', 'Diode_SMD:D_MiniMELF'],
    pinNames: { 1: 'K', 2: 'A' },
    visual: {
      box: [-30, -6, 60, 12],
      hit: [-12, -6, 24, 12],
      pins: { 2: [-30, 0], 1: [30, 0] },
      draw() {
        return leg(-30, 0, -12, 0) + leg(12, 0, 30, 0) +
          `<rect x="-12" y="-4.5" width="24" height="9" rx="3" fill="#f2a65a" fill-opacity=".9" stroke="#b5651d"/>` +
          `<rect x="6" y="-4.5" width="3" height="9" fill="#222"/>`;
      },
    },
    sym: {
      gfx: [POLY([-0.5, -0.6], [0.5, 0], [-0.5, 0.6]), L([0.7, -0.75], [0.5, -0.6], [0.5, 0.6], [0.3, 0.75]), L([-0.5, 0], [0.5, 0])],
      pins: { 2: pin(-2, 0, 'R', 1.5), 1: pin(2, 0, 'L', 1.5) },
      ref: [0, -1.1, 'middle'], val: [0, 1.2, 'middle'],
    },
  };

  defs.inductor = {
    name: 'Катушка индуктивности', prefix: 'L', cat: 'Пассивные', value: '10uH', kicadName: 'L',
    footprint: 'Inductor_THT:L_Axial_L5.3mm_D2.2mm_P10.16mm_Horizontal_Vishay_IM-1', eePackage: 'AXIAL-0.4',
    visual: {
      box: [-30, -7, 60, 14],
      hit: [-16, -7, 32, 14],
      pins: { 1: [-30, 0], 2: [30, 0] },
      draw(c) {
        const b = resistorBands(String(c.value).replace(/H$/i, '').replace(/u$/, '') || '10');
        return leg(-30, 0, -15, 0) + leg(15, 0, 30, 0) +
          `<rect x="-16" y="-6" width="32" height="12" rx="5" fill="#5f9e6e" stroke="#3b6b47"/>` +
          `<rect x="-9" y="-6" width="3" height="12" fill="${b[0]}"/><rect x="-3" y="-6" width="3" height="12" fill="${b[1]}"/>` +
          `<rect x="3" y="-6" width="3" height="12" fill="${b[2]}"/>`;
      },
    },
    sym: {
      gfx: [L(...arc(-0.75, 0, 0.25, 180, 360, 6)), L(...arc(-0.25, 0, 0.25, 180, 360, 6)), L(...arc(0.25, 0, 0.25, 180, 360, 6)), L(...arc(0.75, 0, 0.25, 180, 360, 6))],
      pins: { 1: pin(-2, 0, 'R', 1), 2: pin(2, 0, 'L', 1) },
      ref: [0, -0.9, 'middle'], val: [0, 0.9, 'middle'],
    },
  };

  defs.crystal = {
    name: 'Кварцевый резонатор', prefix: 'Y', cat: 'Пассивные', value: '16MHz', kicadName: 'Crystal',
    footprint: 'Crystal:Crystal_HC49-4H_Vertical', eePackage: 'HC-49S',
    visual: {
      box: [-16, -12, 32, 32],
      hit: [-16, -12, 32, 18],
      pins: { 1: [-10, 20], 2: [10, 20] },
      draw(c) {
        return leg(-10, 6, -10, 20) + leg(10, 6, 10, 20) +
          `<rect x="-16" y="-12" width="32" height="18" rx="9" fill="#cfd4d9" stroke="#8a9199"/>` +
          `<rect x="-12" y="-9" width="24" height="12" rx="6" fill="none" stroke="#a7aeb5"/>` + txt(0, -3, c.value, 5, '#444');
      },
    },
    sym: {
      gfx: [RECT(-0.25, -0.6, 0.25, 0.6), L([-0.5, -0.7], [-0.5, 0.7]), L([0.5, -0.7], [0.5, 0.7])],
      pins: { 1: pin(-2, 0, 'R', 1.5), 2: pin(2, 0, 'L', 1.5) },
      ref: [0, -1.2, 'middle'], val: [0, 1.3, 'middle'],
    },
  };

  defs.ldr = {
    name: 'Фоторезистор', prefix: 'R', cat: 'Датчики', value: 'GL5528', kicadName: 'R_Photo',
    footprint: 'OptoDevice:R_LDR_5.1x4.3mm_P3.4mm_Vertical', eePackage: 'LDR-5MM',
    visual: {
      box: [-12, -16, 24, 36],
      hit: [-12, -16, 24, 22],
      pins: { 1: [-10, 20], 2: [10, 20] },
      draw() {
        return leg(-6, 4, -10, 20) + leg(6, 4, 10, 20) +
          `<circle cx="0" cy="-5" r="11" fill="#f5e6c8" stroke="#a08560"/>` +
          `<path d="M -7 -10 h 12 v 3 h -10 v 3 h 10 v 3 h -12" fill="none" stroke="#c0392b" stroke-width="1.6"/>`;
      },
    },
    sym: {
      gfx: [RECT(-1, -0.4, 1, 0.4), L([-0.8, -1.4], [-0.3, -0.7]), arrowHead(-0.8, -1.4, -0.3, -0.7, 0.25), L([-0.2, -1.4], [0.3, -0.7]), arrowHead(-0.2, -1.4, 0.3, -0.7, 0.25)],
      pins: { 1: pin(-2, 0, 'R', 1), 2: pin(2, 0, 'L', 1) },
      ref: [0, -1.8, 'middle'], val: [0, 1.1, 'middle'],
    },
  };

  defs.spdt = {
    name: 'Переключатель', prefix: 'SW', cat: 'Управление', value: 'SPDT', kicadName: 'SW_SPDT',
    footprint: 'Button_Switch_THT:SW_Slide_SPDT_Straight_CK_OS102011MS2Q', eePackage: 'SW-SLIDE-3P',
    pinNames: { 1: 'A', 2: 'COM', 3: 'B' },
    visual: {
      box: [-17, -12, 34, 32],
      hit: [-17, -12, 34, 16],
      pins: { 1: [-10, 20], 2: [0, 20], 3: [10, 20] },
      draw(c) {
        const on = c.props && c.props.pos === 'b';
        return leg(-10, 4, -10, 20) + leg(0, 4, 0, 20) + leg(10, 4, 10, 20) +
          `<rect x="-17" y="-12" width="34" height="16" rx="2" fill="#2f3337" stroke="#111"/>` +
          `<rect x="-12" y="-8" width="24" height="8" rx="1" fill="#15181b"/>` +
          `<rect x="${on ? 1 : -11}" y="-10" width="10" height="12" rx="1.5" fill="#eceff1" stroke="#90a4ae"/>`;
      },
    },
    props: [{ key: 'pos', label: 'Положение (только вид)', options: { a: 'COM — A', b: 'COM — B' }, def: 'a' }],
    sym: {
      gfx: [CIRC(-0.9, 0, 0.12), CIRC(0.9, -1, 0.12), CIRC(0.9, 1, 0.12), L([-0.8, -0.05], [0.8, -0.85])],
      pins: { 2: pin(-2, 0, 'R', 1), 1: pin(2, -1, 'L', 1), 3: pin(2, 1, 'L', 1) },
      ref: [0, -1.8, 'middle'], val: [0, 1.9, 'middle'],
    },
  };

  defs.motor = {
    name: 'Мотор', prefix: 'M', cat: 'Управление', value: 'Motor', kicadName: 'Motor_DC',
    footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical', eePackage: 'HDR-2P',
    pinNames: { 1: '+', 2: '−' },
    visual: {
      box: [-18, -32, 36, 52],
      hit: [-18, -32, 36, 38],
      pins: { 1: [-10, 20], 2: [10, 20] },
      draw() {
        return leg(-10, 4, -10, 20) + leg(10, 4, 10, 20) +
          `<circle cx="0" cy="-13" r="17" fill="#b0b5ba" stroke="#6d747b"/>` +
          `<circle cx="0" cy="-13" r="4" fill="#e8eaec" stroke="#6d747b"/>` + txt(0, -1, 'M', 7, '#333', 'font-weight="700"') +
          txt(-14, 13, '+', 8, '#c62828', 'font-weight="700"');
      },
    },
    sym: {
      gfx: [CIRC(0, 0, 0.9), TXT(0, 0, 'M', 0.9)],
      pins: { 1: pin(0, -2, 'D', 1.1), 2: pin(0, 2, 'U', 1.1) },
      ref: [1.2, -0.3, 'start'], val: [1.2, 0.6, 'start'],
    },
  };

  defs.button = {
    name: 'Кнопка', prefix: 'SW', cat: 'Управление', value: 'BTN', kicadName: 'SW_Push',
    footprint: 'Button_Switch_THT:SW_PUSH_6mm', eePackage: 'KEY-6X6',
    fpAlt: ['Button_Switch_THT:SW_PUSH_6mm_H5mm', 'Button_Switch_SMD:SW_SPST_TL3342'],
    visual: {
      box: [-20, -15, 40, 30],
      pins: { 1: [-20, 0], 2: [20, 0] },
      draw() {
        return leg(-20, 0, -13, 0) + leg(13, 0, 20, 0) +
          `<rect x="-14" y="-14" width="28" height="28" rx="3" fill="#3a3f45" stroke="#1f2226"/>` +
          [[-11, -11], [11, -11], [-11, 11], [11, 11]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#8b929a"/>`).join('') +
          `<circle cx="0" cy="0" r="8.5" fill="#111" stroke="#555"/><circle cx="-2" cy="-2" r="3" fill="#333"/>`;
      },
    },
    sym: {
      gfx: [CIRC(-1, 0, 0.15), CIRC(1, 0, 0.15), L([-1.2, -0.5], [1.2, -0.5]), L([0, -0.5], [0, -1])],
      pins: { 1: pin(-2, 0, 'R', 0.85), 2: pin(2, 0, 'L', 0.85) },
      ref: [0, -1.5, 'middle'], val: [0, 0.8, 'middle'],
    },
  };

  defs.pot = {
    name: 'Потенциометр', prefix: 'RV', cat: 'Управление', value: '10k', kicadName: 'R_Potentiometer',
    footprint: 'Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical', eePackage: 'RES-ADJ-TH',
    visual: {
      box: [-15, -24, 30, 44],
      hit: [-15, -24, 30, 28], // область захвата — только корпус, отверстия у ножек остаются доступны
      pins: { 1: [-10, 20], 2: [0, 20], 3: [10, 20] },
      draw(c) {
        return leg(-10, 4, -10, 20) + leg(0, 4, 0, 20) + leg(10, 4, 10, 20) +
          `<rect x="-15" y="-24" width="30" height="28" rx="3" fill="#1565c0" stroke="#0d3f78"/>` +
          `<circle cx="0" cy="-10" r="9" fill="#eceff1" stroke="#90a4ae"/>` +
          `<line x1="0" y1="-17" x2="0" y2="-3" stroke="#78909c" stroke-width="2.4" transform="rotate(35 0 -10)"/>`;
      },
    },
    sym: {
      gfx: [RECT(-1, -0.4, 1, 0.4), arrowHead(0, -0.9, 0, -0.42, 0.4)],
      pins: { 1: pin(-2, 0, 'R', 1), 2: pin(0, -2, 'D', 1.1), 3: pin(2, 0, 'L', 1) },
      ref: [0.5, -1.6, 'start'], val: [0, 1.1, 'middle'],
    },
  };

  defs.battery = {
    name: 'Батарея', prefix: 'BT', cat: 'Питание', value: '9V', kicadName: 'Battery',
    footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical', eePackage: 'HDR-2P',
    pinNames: { 1: '+', 2: '−' },
    pinPower: { 2: 'GND' },
    // «+» батареи 9V — цепь +9V
    pinPowerFn(c) {
      const v = String(c.value || '').trim().replace(/^\+/, '').replace(/\s*[VВ]$/i, '').replace(',', '.');
      return /^\d+(\.\d+)?$/.test(v) ? { 1: '+' + v + 'V' } : {};
    },
    visual: {
      box: [-40, -12, 80, 24],
      pins: { 1: [-40, 0], 2: [40, 0] },
      draw(c) {
        return `<line x1="-40" y1="0" x2="-33" y2="0" stroke="#d32f2f" stroke-width="2.5"/>` +
          `<line x1="30" y1="0" x2="40" y2="0" stroke="#222" stroke-width="2.5"/>` +
          `<rect x="-34" y="-4" width="5" height="8" rx="1" fill="#b0b5ba"/>` +
          `<rect x="-30" y="-11" width="60" height="22" rx="4" fill="#2e7d32" stroke="#1b4d1f"/>` +
          `<rect x="-30" y="-11" width="16" height="22" rx="4" fill="#fbc02d"/>` +
          txt(-22, 0, '+', 9, '#5d4300', 'font-weight="700"') + txt(8, 0, c.value, 8, '#fff', 'font-weight="600"');
      },
    },
    sym: {
      gfx: [L([-0.2, -0.9], [-0.2, 0.9]), Object.assign(L([0.2, -0.45], [0.2, 0.45]), { w: 2.5 }), TXT(-0.7, -0.7, '+', 0.7)],
      pins: { 1: pin(-2, 0, 'R', 1.8), 2: pin(2, 0, 'L', 1.8) },
      ref: [0, -1.4, 'middle'], val: [0, 1.4, 'middle'],
    },
  };

  defs.buzzer = {
    name: 'Пищалка', prefix: 'BZ', cat: 'Управление', value: 'Buzzer', kicadName: 'Buzzer',
    footprint: 'Buzzer_Beeper:Buzzer_12x9.5RM7.6', eePackage: 'BUZZER-TH',
    pinNames: { 1: '+', 2: '−' },
    visual: {
      box: [-17, -23, 34, 43],
      hit: [-17, -23, 34, 33], // область захвата — только корпус, отверстия у ножек остаются доступны
      pins: { 1: [-10, 20], 2: [10, 20] },
      draw() {
        return leg(-10, 8, -10, 20) + leg(10, 8, 10, 20) +
          `<circle cx="0" cy="-6" r="16" fill="#1b1b1b" stroke="#000"/>` +
          `<circle cx="0" cy="-6" r="3" fill="#000" stroke="#444"/>` + txt(-9, -14, '+', 8, '#bbb', 'font-weight="700"');
      },
    },
    sym: {
      gfx: [L([-1.2, 0.2], [1.2, 0.2]), L(...arc(0, 0.2, 1.1, 180, 360, 10)), TXT(-1.5, 1.1, '+', 0.7)],
      pins: { 1: pin(-1, 2, 'U', 1.8), 2: pin(1, 2, 'U', 1.8) },
      ref: [1.5, -0.8, 'start'], val: [1.5, 0.1, 'start'],
    },
  };

  function header(n) {
    const pins = {}, spins = {};
    for (let i = 0; i < n; i++) {
      pins[i + 1] = [i * 10, 0];
      spins[i + 1] = pin(-2, i, 'R', 1.6);
    }
    return {
      name: `Разъём 1×${n}`, prefix: 'J', cat: 'Разъёмы', value: `Conn_01x0${n}`, kicadName: `Conn_01x0${n}`,
      footprint: `Connector_PinHeader_2.54mm:PinHeader_1x0${n}_P2.54mm_Vertical`, eePackage: `HDR-${n}P`,
      visual: {
        box: [-6, -6, n * 10 + 2, 12],
        pins,
        draw() {
          let s = `<rect x="-6" y="-6" width="${n * 10 + 2}" height="12" rx="1.5" fill="#222" stroke="#000"/>`;
          for (let i = 0; i < n; i++) s += `<rect x="${i * 10 - 2}" y="-2" width="4" height="4" fill="#d4af37"/>`;
          return s;
        },
      },
      sym: {
        gfx: [RECT(-0.4, -0.6, 0.6, n - 0.4, 'body')],
        pins: spins,
        ref: [-0.4, -1.1, 'start'], val: [-0.4, n + 0.3, 'start'],
        showNums: true,
      },
    };
  }
  defs.header2 = header(2);
  defs.header3 = header(3);
  defs.header4 = header(4);
  defs.header6 = header(6);
  defs.header8 = header(8);

  // корпус DIP-8: ряды выводов через 0.3" — встаёт поперёк канавки макетной платы
  const DIP8 = () => ({
    box: [-22, -17, 44, 34],
    hit: [-22, -11, 44, 22], // область захвата — только корпус, отверстия у ножек остаются доступны
    pins: { 1: [-15, 15], 2: [-5, 15], 3: [5, 15], 4: [15, 15], 5: [15, -15], 6: [5, -15], 7: [-5, -15], 8: [-15, -15] },
    draw(c) {
      let s = '';
      [-15, -5, 5, 15].forEach(x => { s += `<rect x="${x - 2}" y="-15" width="4" height="30" fill="#b9bec4"/>`; });
      return s + `<rect x="-22" y="-11" width="44" height="22" rx="2" fill="#2b2b2b" stroke="#000"/>` +
        `<path d="M -22 -5 A 5 5 0 0 1 -22 5" fill="#555"/><circle cx="-16" cy="6" r="1.8" fill="#555"/>` +
        txt(2, 0, c.value, 7, '#ddd', 'font-weight="600"');
    },
  });

  defs.ne555 = {
    name: 'Таймер NE555', refOnly: true, prefix: 'U', cat: 'Микросхемы', value: 'NE555', kicadName: 'NE555',
    footprint: 'Package_DIP:DIP-8_W7.62mm', eePackage: 'DIP-8',
    pinNames: { 1: 'GND', 2: 'TR', 3: 'Q', 4: 'R', 5: 'CV', 6: 'THR', 7: 'DIS', 8: 'VCC' },
    visual: DIP8(),
    sym: makeIC(
      [['4', 'R', 'in'], ['2', 'TR', 'in'], ['6', 'THR', 'in'], ['5', 'CV', 'in']],
      [['8', 'VCC', 'pwr'], ['3', 'Q', 'out'], ['7', 'DIS', 'oc'], ['1', 'GND', 'pwr']], 6),
  };

  defs.lm358 = {
    name: 'ОУ LM358 (×2)', refOnly: true, prefix: 'U', cat: 'Микросхемы', value: 'LM358', kicadName: 'LM358',
    footprint: 'Package_DIP:DIP-8_W7.62mm', eePackage: 'DIP-8',
    pinNames: { 1: 'OUTA', 2: '-INA', 3: '+INA', 4: 'GND', 5: '+INB', 6: '-INB', 7: 'OUTB', 8: 'V+' },
    visual: DIP8(),
    sym: makeIC(
      [['3', '+INA', 'in'], ['2', '-INA', 'in'], ['5', '+INB', 'in'], ['6', '-INB', 'in']],
      [['8', 'V+', 'pwr'], ['1', 'OUTA', 'out'], ['7', 'OUTB', 'out'], ['4', 'GND', 'pwr']], 6),
  };

  // линейный стабилизатор 78xx: выход становится цепью питания (+5V у 7805, +12V у 7812…)
  defs.reg78 = {
    name: 'Стабилизатор 7805', prefix: 'U', cat: 'Питание', value: 'L7805', kicadName: 'L7805',
    footprint: 'Package_TO_SOT_THT:TO-220-3_Vertical', eePackage: 'TO-220-3',
    pinNames: { 1: 'IN', 2: 'GND', 3: 'OUT' },
    pinPower: { 2: 'GND' },
    pinPowerFn(c) {
      const m = String(c.value || '').match(/78[LM]?(\d\d)/i);
      if (!m) return {};
      const v = m[1] === '33' ? '3V3' : String(+m[1]) + 'V';
      return { 3: '+' + v };
    },
    visual: {
      box: [-15, -32, 30, 58],
      hit: [-15, -32, 30, 34],
      pins: { 1: [-10, 20], 2: [0, 20], 3: [10, 20] },
      draw(c) { return to220(c) + pinLabels(['I', 'G', 'O'], 26); },
    },
    sym: {
      gfx: [RECT(-2, -1, 2, 1.6, 'body')],
      pins: { 1: pin(-3, 0, 'R', 1, { name: 'VI', type: 'pwr' }), 3: pin(3, 0, 'L', 1, { name: 'VO' }), 2: pin(0, 3, 'U', 1.4, { name: 'GND', type: 'pwr' }) },
      ref: [-2, -1.6, 'start'], val: [0.5, 2.6, 'start'],
      showNames: true,
    },
  };

  defs.attiny85 = {
    name: 'Микроконтроллер ATtiny85', refOnly: true, prefix: 'U', cat: 'Микросхемы', value: 'ATtiny85', kicadName: 'ATtiny85',
    footprint: 'Package_DIP:DIP-8_W7.62mm', eePackage: 'DIP-8',
    pinNames: { 1: 'PB5/RST', 2: 'PB3', 3: 'PB4', 4: 'GND', 5: 'PB0', 6: 'PB1', 7: 'PB2', 8: 'VCC' },
    visual: DIP8(),
    sym: makeIC(
      [['1', 'PB5/RST'], ['2', 'PB3'], ['3', 'PB4'], ['5', 'PB0'], ['6', 'PB1'], ['7', 'PB2']],
      [['8', 'VCC', 'pwr'], ['4', 'GND', 'pwr']], 7),
  };

  // адресный RGB-светодиод: на макетке — модуль с четырьмя выводами, на плате — корпус 5050
  defs.ws2812b = {
    name: 'RGB-светодиод WS2812B', refOnly: true, prefix: 'LED', cat: 'Полупроводники', value: 'WS2812B', kicadName: 'WS2812B',
    footprint: 'LED_SMD:LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm', eePackage: 'LED-SMD_4P-L5.0-W5.0',
    pinNames: { 1: 'VDD', 2: 'DOUT', 3: 'VSS', 4: 'DIN' },
    visual: {
      box: [-19, -34, 38, 40],
      hit: [-19, -34, 38, 30],
      // порядок на модуле: DIN, VDD, GND, DOUT — цепочка идёт слева направо
      pins: { 4: [-15, 0], 1: [-5, 0], 3: [5, 0], 2: [15, 0] },
      draw() {
        return leg(-15, -4, -15, 0) + leg(-5, -4, -5, 0) + leg(5, -4, 5, 0) + leg(15, -4, 15, 0) +
          `<rect x="-19" y="-34" width="38" height="30" rx="2" fill="#1b1b1b" stroke="#000"/>` +
          `<rect x="-9" y="-30" width="18" height="18" rx="1.5" fill="#f4f4f4" stroke="#bbb"/>` +
          `<circle cx="0" cy="-21" r="6" fill="#fff" stroke="#ddd"/>` +
          [['DI', -15], ['5V', -5], ['G', 5], ['DO', 15]].map(([t, x]) => txt(x, -8, t, 4, '#ccc')).join('');
      },
    },
    sym: {
      gfx: [RECT(-2, -1.5, 2, 1.5, 'body'), TXT(0, 0.6, 'RGB', 0.6)],
      pins: {
        4: pin(-3, 0, 'R', 1, { name: 'DIN', type: 'in' }), 2: pin(3, 0, 'L', 1, { name: 'DOUT', type: 'out' }),
        1: pin(0, -3, 'D', 1.5, { name: 'VDD', type: 'pwr' }), 3: pin(0, 3, 'U', 1.5, { name: 'VSS', type: 'pwr' }),
      },
      ref: [2.2, -2, 'start'], val: [2.2, 2.4, 'start'],
      showNames: true,
    },
  };

  // USB-C (питание + D+/D−): на макетке — переходная плата, на плате — разъём HRO TYPE-C-31-M-12
  defs.usbc = {
    name: 'Разъём USB-C', refOnly: true, prefix: 'USB', cat: 'Разъёмы', value: 'USB-C', kicadName: 'USB_C_Receptacle_USB2.0',
    footprint: 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12', eePackage: 'USB-C-SMD_TYPE-C-31-M-12',
    pinNames: { CC1: 'CC1', VBUS: 'VBUS', GND: 'GND', CC2: 'CC2', DN: 'D−', DP: 'D+' },
    pinPower: { VBUS: '+5V', GND: 'GND' },
    // площадки разъёма → выводы (SBU не подключены)
    padMap: {
      A1: 'GND', A12: 'GND', B1: 'GND', B12: 'GND', SH: 'GND',
      A4: 'VBUS', A9: 'VBUS', B4: 'VBUS', B9: 'VBUS',
      A5: 'CC1', B5: 'CC2', A6: 'DP', B6: 'DP', A7: 'DN', B7: 'DN',
    },
    visual: {
      box: [-31, -6, 62, 42],
      hit: [-31, 4, 62, 32],
      pins: { CC1: [-25, 0], VBUS: [-15, 0], GND: [-5, 0], CC2: [5, 0], DN: [15, 0], DP: [25, 0] },
      draw() {
        let s = `<rect x="-31" y="4" width="62" height="32" rx="2" fill="#1d4e9e" stroke="#0e2c5c"/>` +
          `<rect x="-11" y="24" width="22" height="12" rx="4" fill="#c7ccd1" stroke="#7d848b"/><rect x="-7" y="28" width="14" height="4" rx="2" fill="#555"/>`;
        [['CC1', -25], ['5V', -15], ['G', -5], ['CC2', 5], ['D−', 15], ['D+', 25]].forEach(([t, x]) => { s += leg(x, 0, x, 6) + txt(x, 12, t, 4.2, '#fff'); });
        return s;
      },
    },
    sym: {
      gfx: [RECT(-2, -3, 2, 3, 'body')],
      pins: {
        VBUS: pin(4, -2, 'L', 2, { name: 'VBUS' }), CC1: pin(4, -1, 'L', 2, { name: 'CC1' }), CC2: pin(4, 0, 'L', 2, { name: 'CC2' }),
        DP: pin(4, 1, 'L', 2, { name: 'D+' }), DN: pin(4, 2, 'L', 2, { name: 'D−' }), GND: pin(0, 4, 'U', 1, { name: 'GND' }),
      },
      ref: [-2, -3.6, 'start'], val: [0.6, 4.2, 'start'],
      showNames: true,
    },
  };

  // контакт / монтажное отверстие с металлизацией (на плате — кольцо с отверстием)
  defs.mhole = {
    name: 'Контакт (отверстие)', prefix: 'H', cat: 'Разъёмы', value: 'Pad', kicadName: 'TestPoint_Hole',
    footprint: 'MountingHole:MountingHole_2.2mm_M2_Pad',
    fpAlt: ['TestPoint:TestPoint_THTPad_D3.0mm_Drill1.5mm', 'TestPoint:TestPoint_THTPad_D4.0mm_Drill2.0mm', 'MountingHole:MountingHole_3.2mm_M3_Pad'],
    visual: {
      box: [-8, -8, 16, 16],
      pins: { 1: [0, 0] },
      draw() { return `<circle cx="0" cy="0" r="7" fill="#d4af37" stroke="#9c7f23"/><circle cx="0" cy="0" r="3.2" fill="#f4f2ec" stroke="#9c7f23"/>`; },
    },
    sym: {
      gfx: [CIRC(0, -0.4, 0.4)],
      pins: { 1: pin(0, 1, 'U', 1) },
      ref: [0.7, -0.6, 'start'], val: [0.7, 0.3, 'start'],
    },
  };

  // Arduino Nano: номера выводов как в KiCad Module:Arduino_Nano
  const nanoTop = [[15, 'D12'], [14, 'D11'], [13, 'D10'], [12, 'D9'], [11, 'D8'], [10, 'D7'], [9, 'D6'], [8, 'D5'], [7, 'D4'], [6, 'D3'], [5, 'D2'], [4, 'GND'], [3, 'RST'], [2, 'RX0'], [1, 'TX1']];
  const nanoBot = [[16, 'D13'], [17, '3V3'], [18, 'AREF'], [19, 'A0'], [20, 'A1'], [21, 'A2'], [22, 'A3'], [23, 'A4'], [24, 'A5'], [25, 'A6'], [26, 'A7'], [27, '5V'], [28, 'RST'], [29, 'GND'], [30, 'VIN']];
  const nanoPins = {}, nanoNames = {};
  nanoTop.forEach(([n, name], i) => { nanoPins[n] = [-70 + i * 10, -30]; nanoNames[n] = name; });
  nanoBot.forEach(([n, name], i) => { nanoPins[n] = [-70 + i * 10, 30]; nanoNames[n] = name; });
  nanoNames[1] = 'D1/TX'; nanoNames[2] = 'D0/RX';

  defs.nano = {
    name: 'Arduino Nano', refOnly: true, prefix: 'A', cat: 'Микросхемы', value: 'Arduino_Nano', kicadName: 'Arduino_Nano',
    footprint: 'Module:Arduino_Nano', eePackage: 'ARDUINO-NANO',
    pinNames: nanoNames,
    pinPower: { 4: 'GND', 29: 'GND', 27: '+5V', 17: '+3V3', 30: 'VIN' },
    visual: {
      box: [-98, -38, 188, 76],
      pins: nanoPins,
      draw() {
        let s = `<rect x="-90" y="-38" width="180" height="76" rx="4" fill="#1d6fb8" stroke="#0d3f6e"/>` +
          `<rect x="-98" y="-12" width="22" height="24" rx="2" fill="#c7ccd1" stroke="#7d848b"/>` +
          `<rect x="-14" y="-14" width="28" height="28" fill="#1a1a1a" transform="rotate(45)"/>` +
          `<rect x="40" y="-8" width="14" height="10" rx="1.5" fill="#e0e0e0"/>` +
          txt(-34, 0, 'Arduino Nano', 8, '#fff', 'font-weight="700"');
        nanoTop.forEach(([, name], i) => { s += txt(-70 + i * 10, -21, name, 4.2, '#fff'); });
        nanoBot.forEach(([, name], i) => { s += txt(-70 + i * 10, 21, name, 4.2, '#fff'); });
        Object.values(nanoPins).forEach(([x, y]) => { s += `<circle cx="${x}" cy="${y}" r="3.4" fill="#d4af37"/>`; });
        return s;
      },
    },
    sym: makeIC(
      [['2', 'D0/RX'], ['1', 'D1/TX'], ['5', 'D2'], ['6', 'D3'], ['7', 'D4'], ['8', 'D5'], ['9', 'D6'], ['10', 'D7'], ['11', 'D8'], ['12', 'D9'], ['13', 'D10'], ['14', 'D11'], ['15', 'D12'], ['16', 'D13']],
      [['3', 'RESET'], ['28', 'RESET'], ['18', 'AREF'], ['19', 'A0'], ['20', 'A1'], ['21', 'A2'], ['22', 'A3'], ['23', 'A4'], ['24', 'A5'], ['25', 'A6'], ['26', 'A7'],
        ['17', '3V3', 'pwr'], ['27', '+5V', 'pwr'], ['30', 'VIN', 'pwr'], ['4', 'GND', 'pwr'], ['29', 'GND', 'pwr']], 8),
  };

  // ---------- «виртуальные» элементы: на схеме становятся символами питания / не рисуются ----------
  const POWER_NAMES = { '+5V': '+5V', '+3V3': '+3.3V', '+9V': '+9V', '+12V': '+12V', VCC: 'VCC', VIN: 'VIN' };
  defs.power = {
    name: 'Питание (+)', prefix: '#PWR', cat: 'Питание', value: '+5V', virtual: true, powerSource: true,
    props: [{ key: 'net', label: 'Цепь', options: POWER_NAMES, def: '+5V' }],
    visual: {
      box: [-18, -14, 36, 34],
      pins: { 1: [0, 20] },
      draw(c) {
        return leg(0, 8, 0, 20) + `<rect x="-18" y="-14" width="36" height="22" rx="5" fill="#d32f2f" stroke="#8e1c1c"/>` +
          txt(0, -3, (c.props && c.props.net) || '+5V', 8, '#fff', 'font-weight="700"');
      },
    },
  };
  defs.gnd = {
    name: 'Земля (GND)', prefix: '#PWR', cat: 'Питание', value: 'GND', virtual: true, powerSource: true, fixedNet: 'GND',
    visual: {
      box: [-18, -20, 36, 34],
      pins: { 1: [0, -20] },
      draw() {
        return leg(0, -20, 0, -8) + `<rect x="-18" y="-8" width="36" height="22" rx="5" fill="#263238" stroke="#000"/>` +
          txt(0, 3, 'GND', 8, '#fff', 'font-weight="700"');
      },
    },
  };
  defs.node = {
    name: 'Узел (соединение)', prefix: '#N', cat: 'Питание', value: '', virtual: true,
    visual: {
      box: [-6, -6, 12, 12],
      pins: { 1: [0, 0] },
      draw() { return `<circle cx="0" cy="0" r="6" fill="#455a64" fill-opacity=".25" stroke="#455a64" stroke-dasharray="2 2"/>`; },
    },
  };

  // Кэшируем габариты символов
  Object.entries(defs).forEach(([type, d]) => {
    d.type = type;
    if (d.sym) d.sym.bbox = AK.symBBox(d.sym);
  });

  // общие функции рисования — для компонентов из библиотеки EasyEDA
  AK.DRAW = { leg, txt, resistorBands, capCode, LED_COLORS };

  return defs;
})();

AK.pinName = function (type, pin) {
  const d = AK.LIB[type];
  if (d.sym && d.sym.pins[pin] && d.sym.pins[pin].name) return d.sym.pins[pin].name;
  if (d.pinNames && d.pinNames[pin]) return d.pinNames[pin];
  return String(pin);
};

// Позиция вывода компонента в мировых координатах режима «Монтаж»
AK.pinWorld = function (comp, pinId) {
  const p = AK.LIB[comp.type].visual.pins[pinId];
  const [rx, ry] = AK.util.rotPt(p[0], p[1], comp.rot || 0);
  return [comp.x + rx, comp.y + ry];
};

// Привязка к сетке 0.1": выводы (а не центр) компонента попадают в отверстия
AK.snapPos = function (type, rot, x, y) {
  const p0 = Object.values(AK.LIB[type].visual.pins)[0];
  const [ox, oy] = AK.util.rotPt(p0[0], p0[1], rot || 0);
  return [Math.round((x + ox) / 10) * 10 - ox, Math.round((y + oy) / 10) * 10 - oy];
};

AK.compWorldBox = function (comp) {
  const [bx, by, bw, bh] = AK.LIB[comp.type].visual.box;
  const pts = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]].map(([x, y]) => AK.util.rotPt(x, y, comp.rot || 0));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: comp.x + Math.min(...xs), y: comp.y + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
