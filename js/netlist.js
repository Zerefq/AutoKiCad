// Построение списка цепей (netlist) из проводов режима «Монтаж»
window.AK = window.AK || {};

AK.POWER_RE = /^(GND|AGND|DGND|PGND|VCC|VDD|VEE|VSS|VIN|VBAT|[+-]\d+(\.\d+)?V\d*)$/i;

AK.buildNetlist = function (project) {
  const parent = new Map();
  const find = k => {
    while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); }
    return k;
  };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
  const key = (c, p) => c + ':' + p;

  const comps = new Map(project.components.map(c => [c.id, c]));
  project.components.forEach(c => {
    Object.keys(AK.LIB[c.type].visual.pins).forEach(p => parent.set(key(c.id, p), key(c.id, p)));
  });

  const wired = new Set();
  project.wires.forEach(w => {
    const a = key(w.from.c, w.from.p), b = key(w.to.c, w.to.p);
    if (!parent.has(a) || !parent.has(b)) return;
    union(a, b);
    wired.add(a); wired.add(b);
  });

  // Полоски макетной платы
  project.components.forEach(c => {
    const g = AK.LIB[c.type].groups;
    if (g) g.forEach(ps => ps.forEach(p => union(key(c.id, ps[0]), key(c.id, p))));
  });
  // Выводы в одной точке соединены: ножка в отверстии платы или ножка к ножке
  const at = new Map();
  project.components.forEach(c => Object.keys(AK.LIB[c.type].visual.pins).forEach(p => {
    const s = AK.pinWorld(c, p).map(Math.round).join(',');
    if (!at.has(s)) at.set(s, []);
    at.get(s).push(key(c.id, p));
  }));
  const plugged = new Set();
  at.forEach(ks => {
    if (ks.length < 2) return;
    ks.forEach(k => { union(ks[0], k); plugged.add(k); });
    // ножка в пустом отверстии ещё не соединение; две ножки в одной точке — соединение
    if (ks.filter(k => !AK.LIB[comps.get(k.split(':')[0]).type].board).length > 1) ks.forEach(k => wired.add(k));
  });

  // Имена цепей: 3 — задано пользователем на проводе, 2 — источник питания, 1 — подсказка вывода (GND у Arduino и т.п.)
  const names = new Map(); // root -> [{name, prio}]
  const addName = (k, name, prio) => {
    if (!name) return;
    const r = find(k);
    if (!names.has(r)) names.set(r, []);
    names.get(r).push({ name: String(name).trim(), prio });
  };
  project.wires.forEach(w => { if (w.net && w.net.trim()) addName(key(w.from.c, w.from.p), w.net, 3); });
  project.components.forEach(c => {
    const d = AK.LIB[c.type];
    if (d.powerSource) addName(key(c.id, '1'), d.fixedNet || (c.props && c.props.net) || c.value, 2);
    const pp = Object.assign({}, d.pinPower, d.pinPowerFn && d.pinPowerFn(c));
    Object.entries(pp).forEach(([p, n]) => addName(key(c.id, p), n, 1));
  });

  const warnings = [];
  const groups = new Map();
  parent.forEach((_, k) => {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(k);
  });

  // Сливаем группы с одинаковыми именами (одноимённые цепи питания соединены глобально)
  const byName = new Map();
  const nets = [];
  groups.forEach((keys, r) => {
    const cand = names.get(r) || [];
    let name = null, prio = 0, power = false;
    if (cand.length) {
      prio = Math.max(...cand.map(c => c.prio));
      const top = [...new Set(cand.filter(c => c.prio === prio).map(c => c.name))];
      name = top[0];
      if (top.length > 1) {
        const pins = keys.filter(k => wired.has(k)).length;
        if (pins > 0 || prio > 1) warnings.push({ level: prio >= 2 ? 'error' : 'warn', text: `Замкнуты разные цепи: ${top.join(' и ')}` });
      }
      // источник питания — всегда шина; имя, заданное на проводе, — только если похоже на питание
      power = cand.some(c => c.prio === 2) || AK.POWER_RE.test(name);
    }
    const pins = keys.map(k => { const [c, p] = k.split(':'); return { c, p }; });
    const net = { name, prio, power, pins, wired: keys.some(k => wired.has(k)) };
    if (name && byName.has(name)) {
      const other = byName.get(name);
      other.pins.push(...pins);
      other.prio = Math.max(other.prio, prio);
      other.power = other.power || power;
      other.wired = other.wired || net.wired;
    } else {
      if (name) byName.set(name, net);
      nets.push(net);
    }
  });

  let auto = 1;
  const used = new Set(nets.filter(n => n.name).map(n => n.name));
  const pinNet = new Map();
  nets.forEach((n, i) => {
    n.id = i;
    // реальные (не виртуальные) выводы
    n.real = n.pins.filter(p => !AK.LIB[comps.get(p.c).type].virtual);
    // Цепь, названная лишь подсказкой вывода (GND у Arduino) и ни с чем не соединённая, не рисуется
    const hintOnly = n.prio === 1 && !n.wired;
    n.drawn = !hintOnly && (n.real.length >= 2 || (n.power && n.real.length >= 1));
    if (!n.name && n.drawn) {
      while (used.has('N' + auto)) auto++;
      n.name = 'N' + auto++;
    }
    n.pins.forEach(p => pinNet.set(key(p.c, p.p), n));
  });

  // Предупреждения о неподключённых выводах и типичных ошибках (как ERC в KiCad)
  project.components.forEach(c => {
    const d = AK.LIB[c.type];
    if (d.virtual) return;
    if (d.sym) Object.entries(d.sym.pins).forEach(([p, sp]) => {
      const n = pinNet.get(key(c.id, p));
      if (!n || !n.drawn) return;
      if (sp.type === 'pwr' && !n.power) warnings.push({ level: 'warn', text: `${c.ref}: вывод питания ${sp.name} подключён к сигнальной цепи ${n.name}` });
      if ((sp.type === 'out' || sp.type === 'oc') && n.power) warnings.push({ level: 'warn', text: `${c.ref}: выход ${sp.name} замкнут на шину ${n.name}` });
    });
    const pins = Object.keys(d.visual.pins);
    const free = pins.filter(p => { const n = pinNet.get(key(c.id, p)); return !n || !n.drawn; });
    if (free.length === pins.length) warnings.push({ level: 'info', text: `${c.ref}: не подключён` });
    else if (free.length && pins.length <= 3) warnings.push({ level: 'info', text: `${c.ref}: свободный вывод ${free.map(p => AK.pinName(c.type, p)).join(', ')}` });
  });

  return { nets, pinNet, warnings, key, plugged, drawn: nets.filter(n => n.drawn) };
};
