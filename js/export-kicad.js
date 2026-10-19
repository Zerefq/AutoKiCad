// Экспорт в KiCad 8 (.kicad_sch) и netlist (.net)
window.AK = window.AK || {};

AK.exportKicad = (function () {
  const MM = 2.54;
  const f = n => AK.util.fmt(n, 4);
  const q = s => '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const FONT = '(effects (font (size 1.27 1.27)))';
  const FONT_HIDE = '(effects (font (size 1.27 1.27)) hide)';
  const STROKE = '(stroke (width 0.254) (type default))';
  const ANG = { R: 0, L: 180, U: 90, D: 270 }; // dir (к корпусу) -> угол KiCad (ось Y вверх)

  // координаты библиотеки KiCad: Y вверх
  const lx = x => f(x * MM), ly = y => f(-y * MM);

  // libPrefix=true — для lib_symbols внутри схемы, false — для файла библиотеки .kicad_sym
  function libSymbol(def, libPrefix = true) {
    const s = def.sym, name = def.kicadName;
    const out = [];
    const TYPES = { pwr: 'power_in', out: 'output', in: 'input', oc: 'open_collector' };
    const pinType = p => TYPES[p.type] || (s.ic ? 'bidirectional' : 'passive');
    out.push(`(symbol ${q((libPrefix ? 'AutoKiCad:' : '') + name)}` +
      (s.showNums ? '' : ' (pin_numbers hide)') +
      (s.showNames ? ' (pin_names (offset 0.508))' : ' (pin_names (offset 0) hide)') +
      ' (exclude_from_sim no) (in_bom yes) (on_board yes)');
    out.push(`  (property "Reference" ${q(def.prefix)} (at ${lx(s.ref[0])} ${ly(s.ref[1])} 0) ${FONT})`);
    out.push(`  (property "Value" ${q(def.value)} (at ${lx(s.val[0])} ${ly(s.val[1])} 0) ${FONT})`);
    out.push(`  (property "Footprint" ${q(def.footprint || '')} (at 0 0 0) ${FONT_HIDE})`);
    out.push(`  (property "Datasheet" "~" (at 0 0 0) ${FONT_HIDE})`);
    out.push(`  (symbol ${q(name + '_0_1')}`);
    s.gfx.forEach(g => {
      const st = g.w ? `(stroke (width ${f(0.254 * g.w)}) (type default))` : STROKE;
      if (g.t === 'line') out.push(`    (polyline (pts ${g.pts.map(p => `(xy ${lx(p[0])} ${ly(p[1])})`).join(' ')}) ${st} (fill (type none)))`);
      else if (g.t === 'poly') out.push(`    (polyline (pts ${[...g.pts, g.pts[0]].map(p => `(xy ${lx(p[0])} ${ly(p[1])})`).join(' ')}) ${st} (fill (type outline)))`);
      else if (g.t === 'rect') out.push(`    (rectangle (start ${lx(g.x1)} ${ly(g.y1)}) (end ${lx(g.x2)} ${ly(g.y2)}) ${st} (fill (type ${g.fill === 'body' ? 'background' : 'none'})))`);
      else if (g.t === 'circle') out.push(`    (circle (center ${lx(g.cx)} ${ly(g.cy)}) (radius ${f(g.r * MM)}) ${st} (fill (type none)))`);
      else if (g.t === 'text') out.push(`    (text ${q(g.text)} (at ${lx(g.x)} ${ly(g.y)} 0) ${FONT})`);
    });
    out.push('  )');
    out.push(`  (symbol ${q(name + '_1_1')}`);
    Object.entries(s.pins).forEach(([num, p]) => {
      out.push(`    (pin ${pinType(p)} line (at ${lx(p.x)} ${ly(p.y)} ${ANG[p.dir]}) (length ${f(p.len * MM)}) (name ${q(p.name || '~')} ${FONT}) (number ${q(num)} ${FONT}))`);
    });
    out.push('  )');
    out.push(')');
    return out.join('\n    ');
  }

  // символы питания живут в библиотеке AutoKiCad (PWR_<имя>), чтобы не конфликтовать со штатной power
  const pwrId = name => 'PWR_' + name;

  const PWR_FLAG = (libPrefix = true) => `(symbol "${libPrefix ? 'AutoKiCad:' : ''}PWR_FLAG" (power) (pin_numbers hide) (pin_names (offset 0) hide) (exclude_from_sim no) (in_bom yes) (on_board yes)
      (property "Reference" "#FLG" (at 0 1.905 0) ${FONT_HIDE})
      (property "Value" "PWR_FLAG" (at 0 3.81 0) ${FONT_HIDE})
      (property "Footprint" "" (at 0 0 0) ${FONT_HIDE})
      (property "Datasheet" "~" (at 0 0 0) ${FONT_HIDE})
      (symbol "PWR_FLAG_0_0"
        (pin power_out line (at 0 0 90) (length 0) (name "~" ${FONT}) (number "1" ${FONT}))
      )
      (symbol "PWR_FLAG_0_1"
        (polyline (pts (xy 0 0) (xy 0 1.27) (xy -1.016 1.905) (xy 0 2.54) (xy 1.016 1.905) (xy 0 1.27)) ${STROKE} (fill (type none)))
      )
    )`;

  function powerLib(name, gnd, libPrefix = true) {
    const shape = gnd
      ? `(polyline (pts (xy 0 0) (xy 0 -1.27)) ${STROKE} (fill (type none)))
      (polyline (pts (xy -1.524 -1.27) (xy 1.524 -1.27)) ${STROKE} (fill (type none)))
      (polyline (pts (xy -0.9398 -1.905) (xy 0.9398 -1.905)) ${STROKE} (fill (type none)))
      (polyline (pts (xy -0.3556 -2.54) (xy 0.3556 -2.54)) ${STROKE} (fill (type none)))`
      : `(polyline (pts (xy 0 0) (xy 0 1.524)) ${STROKE} (fill (type none)))
      (polyline (pts (xy -1.27 1.524) (xy 1.27 1.524)) ${STROKE} (fill (type none)))`;
    return `(symbol ${q((libPrefix ? 'AutoKiCad:' : '') + pwrId(name))} (power) (pin_numbers hide) (pin_names (offset 0) hide) (exclude_from_sim no) (in_bom yes) (on_board yes)
      (property "Reference" "#PWR" (at 0 ${gnd ? -6.35 : 3.81} 0) ${FONT_HIDE})
      (property "Value" ${q(name)} (at 0 ${gnd ? -3.81 : 2.286} 0) ${FONT})
      (property "Footprint" "" (at 0 0 0) ${FONT_HIDE})
      (property "Datasheet" "" (at 0 0 0) ${FONT_HIDE})
      (symbol ${q(pwrId(name) + '_0_1')}
      ${shape}
      )
      (symbol ${q(pwrId(name) + '_1_1')}
        (pin power_in line (at 0 0 ${gnd ? 270 : 90}) (length 0) hide (name ${q(name)} ${FONT}) (number "1" ${FONT}))
      )
    )`;
  }

  const PAPERS = [['A4', 297, 210], ['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];

  function sch(project, model) {
    const U = AK.util.uuid;
    const root = U();
    const proj = (project.name || 'autokicad').replace(/[^\w\-]+/g, '_');
    const b = model.bbox;
    const wmm = (b.x2 - b.x1) * MM, hmm = (b.y2 - b.y1) * MM;
    const paper = PAPERS.find(p => p[1] - 50 >= wmm && p[2] - 40 >= hmm) || PAPERS[PAPERS.length - 1];
    // сдвиг: центрируем на листе и выравниваем по сетке 1.27 мм
    // смещение — целое число U, иначе выводы уходят с сетки 1.27 мм
    const ox = Math.round(((paper[1] - wmm) / 2) / MM - b.x1);
    const oy = Math.round(((paper[2] - hmm) / 2) / MM - b.y1);
    const X = x => f((x + ox) * MM), Y = y => f((y + oy) * MM);

    const out = [];
    out.push(`(kicad_sch (version 20231120) (generator "autokicad") (generator_version "1.0")`);
    out.push(`  (uuid ${q(root)})`);
    out.push(`  (paper ${q(paper[0])})`);
    out.push(`  (title_block (title ${q(project.name || 'AutoKiCad')}) (comment 1 "Сгенерировано AutoKiCad из монтажной схемы"))`);

    out.push('  (lib_symbols');
    const used = [...new Set(model.symbols.map(s => s.def.type))];
    used.forEach(t => out.push('    ' + libSymbol(AK.LIB[t])));
    const pnames = [...new Set(model.power.map(p => p.name))];
    pnames.forEach(n => out.push('    ' + powerLib(n, AK.isGndName(n))));
    if (pnames.length) out.push('    ' + PWR_FLAG());
    out.push('  )');

    model.junctions.forEach(([x, y]) => out.push(`  (junction (at ${X(x)} ${Y(y)}) (diameter 0) (color 0 0 0 0) (uuid ${q(U())}))`));
    model.ncs.forEach(([x, y]) => out.push(`  (no_connect (at ${X(x)} ${Y(y)}) (uuid ${q(U())}))`));
    model.wires.forEach(w => out.push(`  (wire (pts (xy ${X(w.x1)} ${Y(w.y1)}) (xy ${X(w.x2)} ${Y(w.y2)})) (stroke (width 0) (type default)) (uuid ${q(U())}))`));
    const LANG = { R: 0, U: 90, L: 180, D: 270 };
    model.labels.forEach(l => {
      const just = (l.dir === 'L' || l.dir === 'D') ? 'right bottom' : 'left bottom';
      out.push(`  (label ${q(l.text)} (at ${X(l.x)} ${Y(l.y)} ${LANG[l.dir]}) (fields_autoplaced yes) (effects (font (size 1.27 1.27)) (justify ${just})) (uuid ${q(U())}))`);
    });

    const inst = ref => `(instances (project ${q(proj)} (path ${q('/' + root)} (reference ${q(ref)}) (unit 1))))`;

    model.symbols.forEach(sy => {
      const d = sy.def, s = d.sym, c = sy.comp;
      out.push(`  (symbol (lib_id ${q('AutoKiCad:' + d.kicadName)}) (at ${X(sy.x)} ${Y(sy.y)} 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid ${q(U())})`);
      const just = a => a === 'start' ? ' (justify left)' : a === 'end' ? ' (justify right)' : '';
      out.push(`    (property "Reference" ${q(c.ref)} (at ${X(sy.x + s.ref[0])} ${Y(sy.y + s.ref[1])} 0) (effects (font (size 1.27 1.27))${just(s.ref[2])}))`);
      out.push(`    (property "Value" ${q(c.value || d.value)} (at ${X(sy.x + s.val[0])} ${Y(sy.y + s.val[1])} 0) (effects (font (size 1.27 1.27))${just(s.val[2])}))`);
      out.push(`    (property "Footprint" ${q(d.footprint || '')} (at ${X(sy.x)} ${Y(sy.y)} 0) ${FONT_HIDE})`);
      out.push(`    (property "Datasheet" "~" (at ${X(sy.x)} ${Y(sy.y)} 0) ${FONT_HIDE})`);
      Object.keys(s.pins).forEach(p => out.push(`    (pin ${q(p)} (uuid ${q(U())}))`));
      out.push(`    ${inst(c.ref)}`);
      out.push('  )');
    });

    model.power.forEach((p, i) => {
      const ref = '#PWR0' + String(i + 1).padStart(2, '0');
      const gnd = p.kind === 'gnd';
      out.push(`  (symbol (lib_id ${q('AutoKiCad:' + pwrId(p.name))}) (at ${X(p.x)} ${Y(p.y)} 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid ${q(U())})`);
      out.push(`    (property "Reference" ${q(ref)} (at ${X(p.x)} ${Y(p.y + (gnd ? 2.5 : -1.5))} 0) ${FONT_HIDE})`);
      out.push(`    (property "Value" ${q(p.name)} (at ${X(p.x)} ${Y(p.y + (gnd ? 1.5 : -0.9))} 0) ${FONT})`);
      out.push(`    (property "Footprint" "" (at ${X(p.x)} ${Y(p.y)} 0) ${FONT_HIDE})`);
      out.push(`    (property "Datasheet" "" (at ${X(p.x)} ${Y(p.y)} 0) ${FONT_HIDE})`);
      out.push(`    (pin "1" (uuid ${q(U())}))`);
      out.push(`    ${inst(ref)}`);
      out.push('  )');
    });

    // PWR_FLAG — по одному на цепь питания, в точке первого её символа (иначе ERC: «power pin not driven»)
    const flagged = new Set();
    model.power.forEach(p => {
      if (flagged.has(p.name)) return;
      flagged.add(p.name);
      const ref = '#FLG0' + String(flagged.size).padStart(2, '0');
      const rot = p.kind === 'gnd' ? 0 : 180; // флаг в сторону, свободную от символа питания
      out.push(`  (symbol (lib_id "AutoKiCad:PWR_FLAG") (at ${X(p.x)} ${Y(p.y)} ${rot}) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid ${q(U())})`);
      out.push(`    (property "Reference" ${q(ref)} (at ${X(p.x)} ${Y(p.y)} 0) ${FONT_HIDE})`);
      out.push(`    (property "Value" "PWR_FLAG" (at ${X(p.x)} ${Y(p.y)} 0) ${FONT_HIDE})`);
      out.push(`    (property "Footprint" "" (at ${X(p.x)} ${Y(p.y)} 0) ${FONT_HIDE})`);
      out.push(`    (property "Datasheet" "~" (at ${X(p.x)} ${Y(p.y)} 0) ${FONT_HIDE})`);
      out.push(`    (pin "1" (uuid ${q(U())}))`);
      out.push(`    ${inst(ref)}`);
      out.push('  )');
    });

    out.push('  (sheet_instances (path "/" (page "1")))');
    out.push(')');
    return out.join('\n') + '\n';
  }

  function netlist(project, nl) {
    const comps = project.components.filter(c => !AK.LIB[c.type].virtual);
    const out = [];
    out.push('(export (version "E")');
    out.push(`  (design (source ${q((project.name || 'autokicad') + '.kicad_sch')}) (date ${q(new Date().toISOString())}) (tool "AutoKiCad"))`);
    out.push('  (components');
    comps.forEach(c => {
      const d = AK.LIB[c.type];
      out.push(`    (comp (ref ${q(c.ref)}) (value ${q(c.value || d.value)}) (footprint ${q(d.footprint || '')}) (libsource (lib "AutoKiCad") (part ${q(d.kicadName)}) (description ${q(d.name)})) (sheetpath (names "/") (tstamps "/")) (tstamps ${q(AK.util.uuid())}))`);
    });
    out.push('  )');
    out.push('  (nets');
    let code = 1;
    nl.drawn.forEach(n => {
      const nodes = n.real.map(p => {
        const c = comps.find(x => x.id === p.c);
        return `(node (ref ${q(c.ref)}) (pin ${q(p.p)}) (pinfunction ${q(AK.pinName(c.type, p.p))}))`;
      });
      out.push(`    (net (code ${q(code++)}) (name ${q(n.name)}) ${nodes.join(' ')})`);
    });
    out.push('  )');
    out.push(')');
    return out.join('\n') + '\n';
  }

  // Библиотека символов проекта: те же символы, что встроены в схему
  function symLib(model) {
    const out = ['(kicad_symbol_lib (version 20231120) (generator "autokicad") (generator_version "1.0")'];
    [...new Set(model.symbols.map(s => s.def.type))].forEach(t => out.push('  ' + libSymbol(AK.LIB[t], false)));
    const pnames = [...new Set(model.power.map(p => p.name))];
    pnames.forEach(n => out.push('  ' + powerLib(n, AK.isGndName(n), false)));
    if (pnames.length) out.push('  ' + PWR_FLAG(false));
    out.push(')');
    return out.join('\n') + '\n';
  }

  // Готовый проект KiCad: .kicad_pro + .kicad_sch + библиотека + sym-lib-table, упакованные в zip
  function projectZip(project, model, base) {
    const files = [
      [`${base}/${base}.kicad_pro`, JSON.stringify({ meta: { filename: base + '.kicad_pro', version: 1 } }, null, 2) + '\n'],
      [`${base}/${base}.kicad_sch`, sch(project, model)],
      [`${base}/AutoKiCad.kicad_sym`, symLib(model)],
      [`${base}/sym-lib-table`, '(sym_lib_table\n  (version 7)\n  (lib (name "AutoKiCad")(type "KiCad")(uri "${KIPRJMOD}/AutoKiCad.kicad_sym")(options "")(descr "Символы AutoKiCad"))\n)\n'],
    ];
    return AK.util.zip(files);
  }

  return { sch, netlist, symLib, projectZip };
})();
