// Экспорт в формат исходника схемы EasyEDA Standard (JSON, docType 1).
// Единицы EasyEDA: 10 px = 100 mil = 1 U.
window.AK = window.AK || {};

// opts.native — для расширения: компоненты из библиотеки EasyEDA вставляются «родными» символами
// в их исходных координатах; расширение затем сдвигает их на место (moves) и добавляет остальное (rest).
AK.exportEasyEDA = function (project, model, opts) {
  opts = opts || {};
  let gid = 1;
  const id = () => 'gge' + (gid++);
  const S = 10, OX = 400, OY = 300;
  const b = model.bbox;
  // целочисленное смещение: EasyEDA округляет координаты выводов до целых px
  const bx = Math.floor(b.x1), by = Math.floor(b.y1);
  const X = x => Math.round((x - bx) * S * 100) / 100 + OX;
  const Y = y => Math.round((y - by) * S * 100) / 100 + OY;
  const R2 = v => Math.round(v * 100) / 100;
  const clean = s => String(s == null ? '' : s).replace(/[~`^#@$]/g, '_');
  const BODY = '#880000', PIN = '#880000';
  const shapes = [], nativeLibs = [], moves = [];
  const libPara = (d, c) => {
    const cp = Object.assign({}, d.ee.head.c_para, { pre: c.ref });
    if (c.value && c.value !== d.value) cp.Value = c.value;
    return Object.entries(cp).map(([k, v]) => clean(k) + '`' + clean(v)).join('`') + '`';
  };

  model.symbols.forEach(sy => {
    const d = sy.def, s = d.sym, c = sy.comp;
    if (opts.native && d.ee) {
      const gId = id(), h = d.ee.head;
      // подписи обозначения и номинала (в библиотечном символе их нет — EasyEDA иначе ставит «?» в начало координат)
      const [ox, oy] = d.ee.origin, nx = u => R2(ox + u * S), ny = u => R2(oy + u * S);
      const val = c.value || d.value;
      const texts = [
        `T~P~${nx(s.ref[0])}~${ny(s.ref[1])}~0~#000080~Arial~~~~~comment~${clean(c.ref)}~1~middle~${id()}~0~pinpart`,
        `T~N~${nx(s.val[0])}~${ny(s.val[1]) + 2}~0~#000080~Arial~~~~~comment~${clean(val)}~1~middle~${id()}~0~pinpart`,
      ];
      const own = d.ee.shapes.filter(x => !/^T~[PN]~/.test(x));
      nativeLibs.push(`LIB~${h.x}~${h.y}~${libPara(d, c)}~0~0~${gId}~${h.puuid || ''}~${h.uuid || ''}~0#@$${texts.concat(own).join('#@$')}`);
      const dx = X(sy.x) - d.ee.origin[0], dy = Y(sy.y) - d.ee.origin[1];
      moves.push({ id: gId, ref: c.ref, dx, dy });
      // вывод символа не на сетке 100 mil — короткий провод до точки, куда пришла трасса
      Object.values(s.pins).forEach(p => {
        if (!p.off) return;
        const ax0 = p.ee[0] + dx, ay0 = p.ee[1] + dy, bx0 = X(sy.x + p.x), by0 = Y(sy.y + p.y);
        shapes.push(`W~${ax0} ${ay0} ${bx0} ${ay0} ${bx0} ${by0}~#008800~1~0~none~${id()}~0`);
      });
      return;
    }
    const ax = u => X(sy.x + u), ay = u => Y(sy.y + u);
    const sub = [];
    // посадочное место из библиотеки EasyEDA (js/ee-footprints.js) — для «Конвертировать в печатную плату»;
    // номер вывода = номер площадки EasyEDA, если площадок у вывода несколько — по выводу на каждую, в одной точке
    const ef = (AK.EE_FOOTPRINTS || {})[c.fp || d.footprint];
    const eeNums = num => {
      if (!ef) return [num];
      const pads = d.padMap ? Object.keys(d.padMap).filter(k => d.padMap[k] === num) : [num];
      const out = [].concat(...pads.map(p => ef.map ? ef.map[p] || [] : [p]));
      return out.length ? out : [num];
    };
    sub.push(`T~P~${ax(s.ref[0])}~${ay(s.ref[1])}~0~#000080~Arial~~~~~comment~${clean(c.ref)}~1~${s.ref[2]}~${id()}~0~pinpart`);
    sub.push(`T~N~${ax(s.val[0])}~${ay(s.val[1]) + 2}~0~#000080~Arial~~~~~comment~${clean(c.value || d.value)}~1~${s.val[2]}~${id()}~0~pinpart`);
    s.gfx.forEach(g => {
      const sw = g.w ? g.w : 1;
      if (g.t === 'line') sub.push(`PL~${g.pts.map(p => ax(p[0]) + ' ' + ay(p[1])).join(' ')}~${BODY}~${sw}~0~none~${id()}~0`);
      else if (g.t === 'poly') sub.push(`PG~${g.pts.map(p => ax(p[0]) + ' ' + ay(p[1])).join(' ')}~${BODY}~1~0~${BODY}~${id()}~0`);
      else if (g.t === 'rect') sub.push(`R~${ax(g.x1)}~${ay(g.y1)}~~~${(g.x2 - g.x1) * S}~${(g.y2 - g.y1) * S}~${BODY}~1~0~${g.fill === 'body' ? '#FFFFCC' : 'none'}~${id()}~0`);
      else if (g.t === 'circle') sub.push(`E~${ax(g.cx)}~${ay(g.cy)}~${g.r * S}~${g.r * S}~${BODY}~1~0~none~${id()}~0`);
      else if (g.t === 'text') sub.push(`T~L~${ax(g.x)}~${ay(g.y) + 3}~0~${BODY}~Arial~7pt~~~~comment~${clean(g.text)}~1~middle~${id()}~0~pinpart`);
    });
    const ROT = { R: 180, L: 0, U: 90, D: 270 };
    Object.entries(s.pins).forEach(([num0, p]) => eeNums(num0).forEach((num, k) => {
      const px = ax(p.x), py = ay(p.y);
      const [dx, dy] = AK.DIRV[p.dir];
      const len = p.len * S;
      const path = dx ? `M ${px} ${py} h ${dx * len}` : `M ${px} ${py} v ${dy * len}`;
      const ex = px + dx * len, ey = py + dy * len;
      const name = clean(p.name || num);
      const nameVis = s.showNames && p.name ? 1 : 0;
      const numVis = s.showNums && !k ? 1 : 0;
      // у вертикального вывода имя — по центру, внутри корпуса
      const anchor = dy ? 'middle' : p.dir === 'R' ? 'start' : 'end';
      sub.push(`P~show~0~${clean(num)}~${px}~${py}~${ROT[p.dir]}~${id()}~0^^${px}~${py}^^${path}~${PIN}^^` +
        `${nameVis}~${ex + dx * 3}~${ey + 3 + dy * 5}~0~${name}~${anchor}~~~#0000FF^^` +
        `${numVis}~${(px + ex) / 2}~${py - 1}~0~${clean(num)}~middle~~~#0000FF^^0~${ex}~${ey}^^0~M 0 0`);
    }));
    const para = d.ee ? libPara(d, c) : [
      'package', clean(ef ? ef.t : d.eePackage || ''), 'pre', clean(c.ref), 'spicePre', d.prefix,
      'nameAlias', 'Value', 'Value', clean(c.value || d.value), 'Footprint(KiCad)', clean(c.fp || d.footprint || ''), 'Contributor', 'AutoKiCad',
    ].join('`') + '`';
    // поля заголовка: x, y, c_para, rotation, importFlag, gId, puuid, uuid, locked
    shapes.push(`LIB~${X(sy.x)}~${Y(sy.y)}~${para}~0~0~${id()}~${ef ? ef.u : ''}~~0#@$${sub.join('#@$')}`);
  });

  model.wires.forEach(w => shapes.push(`W~${X(w.x1)} ${Y(w.y1)} ${X(w.x2)} ${Y(w.y2)}~#008800~1~0~none~${id()}~0`));
  model.junctions.forEach(([x, y]) => shapes.push(`J~${X(x)}~${Y(y)}~2.5~#CC0000~${id()}~0`));
  model.ncs.forEach(([x, y]) => {
    const px = X(x), py = Y(y);
    shapes.push(`O~${px}~${py}~${id()}~M ${px - 4} ${py - 4} L ${px + 4} ${py + 4} M ${px + 4} ${py - 4} L ${px - 4} ${py + 4}~#33cc33~0`);
  });
  // метка влево — без поворота, с выравниванием по правому краю (поворот 180° переворачивает текст)
  const LROT = { R: 0, U: 270, L: 0, D: 90 };
  model.labels.forEach(l => {
    const px = X(l.x), py = Y(l.y);
    const anchor = (l.dir === 'L' || l.dir === 'D') ? 'end' : 'start';
    shapes.push(`N~${px}~${py}~${LROT[l.dir]}~#0000FF~${clean(l.text)}~${id()}~${anchor}~${px + (anchor === 'start' ? 2 : -2)}~${py - 3}~Times New Roman~~0`);
  });
  model.power.forEach(p => {
    const px = X(p.x), py = Y(p.y);
    if (p.kind === 'gnd') {
      shapes.push(`F~part_netLabel_gnD~${px}~${py}~0~${id()}~~0^^${px}~${py}^^${clean(p.name)}~#000000~${px - 10}~${py + 25}~0~start~${p.name === 'GND' ? 0 : 1}~Times New Roman~9pt^^` +
        `PL~${px} ${py + 5} ${px} ${py}~#000000~1~0~transparent~${id()}~0^^PL~${px - 6} ${py + 5} ${px + 6} ${py + 5}~#000000~1~0~transparent~${id()}~0^^` +
        `PL~${px - 4} ${py + 7.5} ${px + 4} ${py + 7.5}~#000000~1~0~transparent~${id()}~0^^PL~${px - 1.5} ${py + 10} ${px + 1.5} ${py + 10}~#000000~1~0~transparent~${id()}~0`);
    } else {
      shapes.push(`F~part_netLabel_VCC~${px}~${py}~180~${id()}~~0^^${px}~${py}^^${clean(p.name)}~#000000~${px - 8}~${py - 8}~0~start~1~Times New Roman~9pt^^` +
        `PL~${px} ${py} ${px} ${py - 6}~#000000~1~0~transparent~${id()}~0^^PL~${px - 5} ${py - 6} ${px + 5} ${py - 6}~#000000~1~0~transparent~${id()}~0`);
    }
  });

  const w = (b.x2 - b.x1) * S, h = (b.y2 - b.y1) * S;
  if (opts.native) {
    const head = { docType: '1', editorVersion: '6.5.51', newgId: true, c_para: { 'Prefix Start': '1' }, c_spiceCmd: 'null', hasIdFlag: true, x: '0', y: '0', importFlag: 0, transformList: '' };
    const libDoc = {
      head, canvas: `CA~${Math.max(1200, w + 800)}~${Math.max(1000, h + 600)}~#FFFFFF~yes~#CCCCCC~5~1000~1000~line~5~pixel~5~0~0`,
      shape: nativeLibs, BBox: { x: OX - 20, y: OY - 20, width: w + 40, height: h + 40 }, colors: {},
    };
    return { libDoc, moves, rest: shapes };
  }
  const doc = {
    head: {
      docType: '1', editorVersion: '6.5.40', newgId: true, c_para: { 'Prefix Start': '1' }, c_spiceCmd: 'null',
      hasIdFlag: true, x: '0', y: '0', importFlag: 0, transformList: '',
    },
    canvas: `CA~${Math.max(1200, w + 800)}~${Math.max(1000, h + 600)}~#FFFFFF~yes~#CCCCCC~5~1000~1000~line~5~pixel~5~0~0`,
    shape: shapes,
    BBox: { x: OX - 20, y: OY - 20, width: w + 40, height: h + 40 },
    colors: {},
  };
  return JSON.stringify(doc, null, 1);
};
