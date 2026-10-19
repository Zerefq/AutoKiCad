// Приложение: состояние проекта, вкладки, инспектор, история, файлы
window.AK = window.AK || {};

// открыт ли AutoKiCad внутри EasyEDA (окно расширения)
AK.EMBED = window.parent !== window;

AK.App = class {
  constructor() {
    this.sel = null;
    this.tab = 'board';
    this.undoStack = [];
    this.redoStack = [];
    this.project = (/demo/.test(location.search) && AK.demoProject()) || this.load() || AK.emptyProject();
    this.editor = new AK.Editor(document.getElementById('board'), this);
    this.schView = new AK.SchView(document.getElementById('sch'), this);
    this.buildPalette();
    this.bindUI();
    this.changed({ noSave: true });
    requestAnimationFrame(() => this.editor.fit());
    if (/sch/.test(location.hash)) this.setTab('sch');
    else if (!/board/.test(location.hash) && window.innerWidth >= 1100) this.setTab('split');
  }

  // ---------------- состояние ----------------
  // кэш привязан к объекту проекта: после замены проекта (пример, отмена, открытие файла) он пересчитывается
  netlist() {
    if (!this.nl || this.nlFor !== this.project) { this.nl = AK.buildNetlist(this.project); this.nlFor = this.project; this.sch = null; }
    return this.nl;
  }
  schematic() {
    const nl = this.netlist();
    if (!this.sch) this.sch = AK.generateSchematic(this.project, nl);
    return this.sch;
  }

  checkpoint() {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.undoStack.pop());
    this.select(null);
    this.changed({ keepView: true });
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.redoStack.pop());
    this.select(null);
    this.changed({ keepView: true });
  }

  changed(opts) {
    opts = opts || {};
    AK.EE.register(this.project);
    this.nl = null; this.sch = null;
    if (!opts.noSave) this.save();
    this.editor.render();
    if (this.tab !== 'board') this.showSchematic(opts.keepView || opts.schOnly);
    this.renderInspector();
    this.renderProjectParts();
  }

  select(sel) {
    this.sel = sel;
    this.renderInspector();
  }
  selectComp(id) { this.select({ kind: 'comp', id }); }

  nextRef(prefix, virtual) {
    let max = 0;
    const re = new RegExp('^' + prefix.replace(/[#$]/g, '\\$&') + '(\\d+)$');
    this.project.components.forEach(c => { const m = (c.ref || '').match(re); if (m) max = Math.max(max, +m[1]); });
    return prefix + (max + 1);
  }

  save() {
    try { localStorage.setItem('autokicad.project.v3', JSON.stringify(this.project)); } catch (e) { /* хранилище недоступно */ }
  }
  load() {
    try {
      let s = localStorage.getItem('autokicad.project.v3');
      if (!s) {
        // проект прежней версии переносим, если это не загруженный пример (раньше программа открывалась с примером)
        s = localStorage.getItem('autokicad.project.v2');
        const old = s && JSON.parse(s);
        if (!old || AK.EXAMPLES.some(x => x.name === old.name)) return null;
      }
      const p = JSON.parse(s);
      return this.validate(p) ? p : null;
    } catch (e) { return null; }
  }
  validate(p) {
    if (p) AK.EE.register(p);
    return p && Array.isArray(p.components) && Array.isArray(p.wires) &&
      p.components.every(c => AK.LIB[c.type]) &&
      p.wires.every(w => w.from && w.to && Array.isArray(w.points));
  }

  // ---------------- вкладки ----------------
  // board — только монтаж, split — монтаж и схема рядом, sch — только схема
  setTab(tab) {
    const resize = (tab === 'split') !== (this.tab === 'split');
    this.tab = tab;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    // у SVG-элементов нет свойства .hidden — работаем с атрибутом
    document.getElementById('board').toggleAttribute('hidden', tab === 'sch');
    document.getElementById('sch').toggleAttribute('hidden', tab === 'board');
    document.querySelector('.stage').classList.toggle('split', tab === 'split');
    document.getElementById('palette').classList.toggle('dim', tab === 'sch');
    this.editor.cancel();
    this.hint(tab === 'sch' ? 'Схема построена автоматически. Перетаскивайте символы — провода перестроятся.' : '');
    if (tab !== 'board') this.showSchematic(false);
    if (resize && tab !== 'sch') requestAnimationFrame(() => this.editor.fit());
    this.renderInspector();
  }

  showSchematic(keepView) {
    const m = this.schematic();
    this.schView.render(m);
    if (!keepView) requestAnimationFrame(() => this.schView.fit());
  }

  // ---------------- палитра ----------------
  buildPalette() {
    const pal = document.getElementById('palette');
    const cats = {};
    Object.values(AK.LIB).forEach(d => { if (!d.fromLibrary) (cats[d.cat] = cats[d.cat] || []).push(d); });
    let html = '<div class="pal-title">Компоненты</div><div class="pal-help">Перетащите на поле или кликните</div>' +
      '<input id="palFilter" class="pal-filter" type="search" placeholder="Фильтр: резистор, LED, 555…">';
    const libOk = AK.EE.available();
    html += `<div class="pal-cat">Библиотека EasyEDA / LCSC</div>
      <form class="ee-search" id="eeSearch"><input id="eeQuery" placeholder="NE555, 10k 0603, C25804…" ${libOk ? '' : 'disabled'}><button ${libOk ? '' : 'disabled'}>Найти</button></form>
      ${libOk ? '' : '<div class="pal-help">Поиск по библиотеке работает, когда AutoKiCad открыт из EasyEDA (расширение).</div>'}
      <div id="eeResults" class="ee-results"></div>
      <div class="ee-attr">Источник: JLCEDA/EasyEDA Official Library · <a href="https://lceda.cn/" target="_blank" rel="noopener">lceda.cn</a> · <a href="https://easyeda.com" target="_blank" rel="noopener">easyeda.com</a></div>
      <div id="palProject"></div>`;
    Object.entries(cats).forEach(([cat, list]) => {
      html += `<div class="pal-cat" data-cat="${AK.util.esc(cat)}">${AK.util.esc(cat)}</div><div class="pal-grid" data-cat="${AK.util.esc(cat)}">`;
      list.forEach(d => { html += this.palItem(d); });
      html += '</div>';
    });
    pal.innerHTML = html;
    this.bindPalItems(pal);
    this.palPartsKey = null;
    this.renderProjectParts();
    document.getElementById('eeSearch').addEventListener('submit', e => { e.preventDefault(); this.searchLibrary(document.getElementById('eeQuery').value.trim()); });
    document.getElementById('palFilter').addEventListener('input', e => this.filterPalette(e.target.value));
  }

  // фильтр встроенных компонентов по названию, номиналу и корпусу
  filterPalette(q) {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const pal = document.getElementById('palette');
    pal.querySelectorAll('.pal-grid[data-cat]').forEach(g => {
      let any = false;
      g.querySelectorAll('.pal-item').forEach(el => {
        const d = AK.LIB[el.dataset.type];
        const hay = [d.name, d.value, d.prefix, d.eePackage, d.kicadName, d.cat].join(' ').toLowerCase();
        el.hidden = !words.every(w => hay.includes(w));
        any = any || !el.hidden;
      });
      g.hidden = !any;
      g.previousElementSibling.hidden = !any;
    });
  }

  palItem(d) {
    const [bx, by, bw, bh] = d.visual.box;
    const pad = 6;
    const fake = { type: d.type, value: d.value, ref: d.prefix, rot: 0, props: this.editor.defaultProps(d) };
    return `<button class="pal-item" draggable="true" data-type="${d.type}" title="${AK.util.esc(d.name)}">` +
      `<svg viewBox="${bx - pad} ${by - pad} ${bw + pad * 2} ${bh + pad * 2}" preserveAspectRatio="xMidYMid meet">${d.visual.draw(fake)}</svg>` +
      `<span>${AK.util.esc(d.name)}</span></button>`;
  }
  bindPalItems(root) {
    root.querySelectorAll('.pal-item').forEach(el => {
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-akc-type', el.dataset.type); e.dataTransfer.effectAllowed = 'copy'; });
      el.addEventListener('click', () => { if (this.tab === 'sch') this.setTab('board'); this.editor.startPlacing(el.dataset.type); });
    });
  }

  // компоненты из библиотеки EasyEDA, уже добавленные в проект
  renderProjectParts() {
    const box = document.getElementById('palProject');
    if (!box) return;
    const parts = Object.values(this.project.eeParts || {}).filter(p => AK.LIB['ee_' + p.uuid]);
    const key = parts.map(p => p.uuid).join(',');
    if (key === this.palPartsKey) return;
    this.palPartsKey = key;
    box.innerHTML = parts.length ? `<div class="pal-cat">В проекте</div><div class="pal-grid">${parts.map(p => this.palItem(AK.LIB['ee_' + p.uuid])).join('')}</div>` : '';
    this.bindPalItems(box);
  }

  async searchLibrary(q) {
    const out = document.getElementById('eeResults');
    if (!q) { out.innerHTML = ''; return; }
    out.innerHTML = '<div class="pal-help">Поиск…</div>';
    try {
      const list = await AK.EE.search(q);
      const e = AK.util.esc;
      out.innerHTML = list.length ? list.map(r => `<button class="ee-item" data-uuid="${e(r.uuid)}" title="${e(r.title + (r.desc ? ' — ' + r.desc : ''))}">` +
        (r.thumb ? `<img src="${e(r.thumb)}" alt="" loading="lazy">` : '<span class="noimg"></span>') +
        `<span><b>${e(r.title)}</b><small>${e(r.package)}${r.lcsc ? ' · ' + e(r.lcsc) : ''}</small></span></button>`).join('')
        : '<div class="pal-help">Ничего не найдено</div>';
      out.querySelectorAll('.ee-item').forEach(b => b.addEventListener('click', () => this.addLibPart(b.dataset.uuid)));
    } catch (err) { out.innerHTML = `<div class="pal-help">Ошибка поиска: ${AK.util.esc(err.message)}</div>`; }
  }

  async addLibPart(uuid) {
    this.toast('Загрузка компонента из библиотеки EasyEDA…');
    try {
      const part = await AK.EE.fetchPart(uuid);
      this.checkpoint();
      this.project.eeParts = this.project.eeParts || {};
      this.project.eeParts[part.uuid] = part;
      AK.EE.register(this.project);
      const d = AK.LIB['ee_' + part.uuid];
      if (!d) throw new Error('не удалось разобрать символ');
      this.save();
      this.renderProjectParts();
      if (this.tab === 'sch') this.setTab('board');
      this.editor.startPlacing(d.type);
      if (!d.visual.fromFootprint) this.toast('Корпус не для макетки (SMD или шаг не 2.54 мм) — выводы показаны как на переходной плате');
    } catch (err) { this.toast('Не удалось загрузить компонент: ' + err.message); }
  }

  // в EasyEDA (расширение): построить схему прямо в редакторе
  sendToEasyEDA() {
    const m = this.schematic();
    if (!m.symbols.length) { this.toast('Сначала добавьте компоненты'); return; }
    const payload = AK.exportEasyEDA(this.project, m, { native: true });
    window.parent.postMessage({ akc: 'build', payload }, '*');
    this.toast('Создаю схему в EasyEDA…');
  }

  // ---------------- инспектор ----------------
  renderInspector() {
    const el = document.getElementById('inspector'), e = AK.util.esc;
    const nl = this.netlist();
    let h = '';
    const sel = this.sel;
    const comp = sel && sel.kind === 'comp' ? this.project.components.find(c => c.id === sel.id) : null;
    const multi = sel && sel.kind === 'multi' ? this.project.components.filter(c => sel.ids.includes(c.id)) : null;
    const wire = sel && sel.kind === 'wire' ? this.project.wires.find(w => w.id === sel.id) : null;

    if (multi) {
      h += `<h3>Выделено: ${multi.length}</h3>`;
      h += `<div class="muted">${e(multi.map(c => AK.LIB[c.type].virtual ? AK.LIB[c.type].name : c.ref).join(', '))}</div>`;
      h += `<div class="btnrow"><button data-a="rot">⟳ Повернуть <kbd>R</kbd></button><button data-a="dup">Копия <kbd>Ctrl+D</kbd></button><button data-a="del" class="danger">Удалить <kbd>Del</kbd></button></div>`;
      h += '<div class="muted small">Перетащите любой из выделенных — сдвинется вся группа. Стрелки — сдвиг на 0.1" (<kbd>Shift</kbd> — на 0.5"). <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> — копировать и вставить.</div>';
    } else if (comp) {
      const d = AK.LIB[comp.type];
      h += `<h3>${e(d.name)}</h3>`;
      if (!d.virtual) {
        h += field('Обозначение', `<input data-f="ref" value="${e(comp.ref)}">`);
        h += field(d.type === 'battery' ? 'Напряжение' : 'Номинал / модель', `<input data-f="value" value="${e(comp.value)}">`);
      }
      (d.props || []).forEach(p => {
        const opts = Object.entries(p.options).map(([k, v]) => `<option value="${e(k)}"${comp.props[p.key] === k ? ' selected' : ''}>${e(v)}</option>`).join('');
        h += field(p.label, `<select data-p="${p.key}">${opts}</select>`);
      });
      if (d.footprint) h += `<div class="muted small">Корпус KiCad: <code>${e(d.footprint)}</code></div>`;
      if (d.fromLibrary) h += `<div class="muted small">Из библиотеки EasyEDA · корпус <code>${e(d.eePackage)}</code>${d.lcsc ? ` · LCSC <code>${e(d.lcsc)}</code>` : ''}${d.visual.fromFootprint ? '' : '<br>Выводы показаны с шагом 2.54 мм (SMD или другой шаг)'}</div>`;
      h += `<div class="btnrow"><button data-a="rot">⟳ Повернуть <kbd>R</kbd></button><button data-a="dup">Копия <kbd>Ctrl+D</kbd></button><button data-a="del" class="danger">Удалить <kbd>Del</kbd></button></div>`;
      if (!d.virtual) {
        h += '<h4>Выводы</h4><table class="pins">';
        Object.keys(d.visual.pins).forEach(p => {
          const n = nl.pinNet.get(comp.id + ':' + p);
          h += `<tr><td>${e(p)}</td><td>${e(AK.pinName(comp.type, p))}</td><td>${n && n.drawn ? `<span class="net">${e(n.name)}</span>` : '<span class="muted">—</span>'}</td></tr>`;
        });
        h += '</table>';
      }
    } else if (wire) {
      h += '<h3>Провод</h3>';
      const a = this.project.components.find(c => c.id === wire.from.c), b = this.project.components.find(c => c.id === wire.to.c);
      const nm = (c, p) => `${e(AK.LIB[c.type].virtual ? AK.LIB[c.type].name : c.ref)}.${e(AK.pinName(c.type, p))}`;
      h += `<div class="muted">${nm(a, wire.from.p)} → ${nm(b, wire.to.p)}</div>`;
      h += field('Цвет', `<div class="swatches">${AK.WIRE_COLORS.map(c => `<button data-color="${c}" style="background:${c}" class="${wire.color === c ? 'on' : ''}"></button>`).join('')}</div>`);
      const n = nl.pinNet.get(wire.from.c + ':' + wire.from.p);
      h += field('Имя цепи', `<input data-f="net" value="${e(wire.net || '')}" placeholder="${e(n && n.name ? n.name : 'авто')}">`);
      h += '<div class="muted small">Имя вида GND, VCC, +5V, +3V3 превращает цепь в шину питания (символ на схеме).</div>';
      h += `<div class="btnrow"><button data-a="del" class="danger">Удалить <kbd>Del</kbd></button></div>`;
      h += '<div class="muted small">Двойной клик по проводу добавляет точку изгиба; точки можно двигать.</div>';
    } else {
      h += '<h3>Проект</h3>';
      h += field('Название', `<input data-proj="name" value="${e(this.project.name || '')}">`);
      const real = this.project.components.filter(c => !AK.LIB[c.type].virtual).length;
      h += `<div class="stats"><div><b>${real}</b><span>компонентов</span></div><div><b>${this.project.wires.length}</b><span>проводов</span></div><div><b>${nl.drawn.length}</b><span>цепей</span></div></div>`;
      if (this.tab !== 'board') {
        h += `<div class="btnrow"><button data-a="relayout">↺ Авторасстановка</button><button data-a="fit">Вписать</button></div>`;
      }
      h += '<h4>Цепи</h4><div class="netlist">';
      nl.drawn.forEach(n => {
        const pins = n.real.map(p => { const c = this.project.components.find(x => x.id === p.c); return `${c.ref}.${AK.pinName(c.type, p.p)}`; });
        h += `<div class="netrow"><span class="net${n.power ? ' pwr' : ''}">${e(n.name)}</span> <span class="muted">${e(pins.join(', '))}</span></div>`;
      });
      if (!nl.drawn.length) h += '<div class="muted">Пока нет соединений. Вставьте ножки компонентов в одну полоску макетной платы или протяните провод.</div>';
      h += '</div>';
      if (nl.warnings.length) {
        h += '<h4>Проверка</h4>';
        nl.warnings.forEach(w => { h += `<div class="warn ${w.level}">${e(w.text)}</div>`; });
      }
      h += `<h4>Как пользоваться</h4><ol class="help">
        <li>Перетащите компоненты из левой панели на макетную плату — ножки встают в отверстия.</li>
        <li>Отверстия одной полоски (a–e или f–j в столбце, шины + и −) соединены внутри платы, как у настоящей.</li>
        <li>Перемычка: потяните от отверстия или вывода к другому отверстию.</li>
        <li>Схема строится сама — справа в режиме <b>«Монтаж + схема»</b> или на вкладке <b>«Схема»</b>.</li>
        <li>Экспортируйте в KiCad или EasyEDA. Готовые схемы — в меню <b>«Примеры»</b>.</li></ol>
        <div class="muted small"><kbd>R</kbd> поворот · <kbd>Del</kbd> удалить · <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> / <kbd>Ctrl+X</kbd> копировать / вставить / вырезать · <kbd>Ctrl+D</kbd> копия · <kbd>Ctrl+A</kbd> выделить всё · стрелки — сдвиг · <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> отмена/повтор<br>
        Рамка левой кнопкой по пустому месту — выделение (<kbd>Shift</kbd> или <kbd>Ctrl</kbd> — добавить), <kbd>Ctrl</kbd>+клик — добавить/убрать компонент · правая или средняя кнопка — сдвиг поля · колесо — масштаб · <kbd>Shift</kbd>+клик при установке — поставить несколько</div>`;
    }
    el.innerHTML = h;

    function field(label, inner) { return `<label class="field"><span>${e(label)}</span>${inner}</label>`; }

    el.querySelectorAll('input[data-f]').forEach(inp => inp.addEventListener('change', () => {
      this.checkpoint();
      const obj = comp || wire;
      obj[inp.dataset.f] = inp.value.trim();
      this.changed({ keepView: true });
    }));
    el.querySelectorAll('select[data-p]').forEach(s => s.addEventListener('change', () => {
      this.checkpoint();
      comp.props[s.dataset.p] = s.value;
      if (s.dataset.p === 'net') comp.value = s.value;
      this.changed({ keepView: true });
    }));
    el.querySelectorAll('input[data-proj]').forEach(inp => inp.addEventListener('change', () => {
      this.project.name = inp.value.trim();
      this.save();
    }));
    el.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
      this.checkpoint();
      wire.color = b.dataset.color;
      this.editor.wireColor = AK.WIRE_COLORS.indexOf(b.dataset.color);
      this.changed({ keepView: true });
    }));
    el.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'rot') this.editor.rotateSelection();
      if (a === 'dup') this.editor.duplicateSelection();
      if (a === 'del') this.editor.deleteSelection();
      if (a === 'fit') this.schView.fit();
      if (a === 'relayout') this.relayout();
    }));
  }

  relayout() {
    this.checkpoint();
    this.project.components.forEach(c => { delete c.sch; });
    this.changed();
  }

  loadExample(id) {
    const ex = AK.EXAMPLES.find(x => x.id === id);
    if (!ex) return;
    this.checkpoint();
    this.project = ex.build();
    this.select(null);
    this.changed();
    this.editor.fit();
    this.toast(`Пример «${ex.name}» загружен. Вернуть прежний проект — Ctrl+Z`);
  }

  // ---------------- UI ----------------
  hint(text) {
    const h = document.getElementById('hint');
    h.textContent = text;
    h.hidden = !text;
  }
  tooltip(html, e) {
    const t = document.getElementById('tooltip');
    if (!html) { t.hidden = true; return; }
    t.innerHTML = html;
    t.hidden = false;
    t.style.left = (e.clientX + 14) + 'px';
    t.style.top = (e.clientY + 14) + 'px';
  }
  toast(text) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  fileBase() { return (this.project.name || 'autokicad').replace(/[\\/:*?"<>|\s]+/g, '_'); }

  exportAs(kind) {
    const base = this.fileBase();
    const nl = this.netlist(), m = this.schematic();
    if (kind !== 'project' && !m.symbols.length) { this.toast('Сначала добавьте компоненты'); return; }
    if (kind === 'kicadzip') {
      const zip = AK.exportKicad.projectZip(this.project, m, base);
      AK.util.download(base + '_kicad.zip', new Blob([zip], { type: 'application/zip' }));
      this.toast('Проект KiCad сохранён (.zip) — распакуйте и откройте .kicad_pro');
    }
    if (kind === 'kicad') { AK.util.download(base + '.kicad_sch', AK.exportKicad.sch(this.project, m)); this.toast('Схема KiCad сохранена (.kicad_sch)'); }
    if (kind === 'net') { AK.util.download(base + '.net', AK.exportKicad.netlist(this.project, nl)); this.toast('Netlist сохранён (.net)'); }
    if (kind === 'easyeda') { AK.util.download(base + '_easyeda.json', AK.exportEasyEDA(this.project, m), 'application/json'); this.toast('Исходник EasyEDA сохранён (.json)'); }
    if (kind === 'svg') { AK.util.download(base + '_schematic.svg', AK.schematicStandaloneSVG(m, this.project.name), 'image/svg+xml'); this.toast('Схема сохранена как SVG'); }
    if (kind === 'project') { AK.util.download(base + '.akc.json', JSON.stringify(this.project, null, 1), 'application/json'); this.toast('Проект сохранён'); }
    if (kind === 'bom') { AK.util.download(base + '_BOM.csv', AK.bomCSV(this.project), 'text/csv;charset=utf-8'); this.toast('Перечень элементов сохранён (.csv)'); }
    if (kind === 'png') {
      AK.util.svgToPng(AK.schematicStandaloneSVG(m, this.project.name), 2)
        .then(blob => { AK.util.download(base + '_schematic.png', blob); this.toast('Схема сохранена как PNG'); })
        .catch(err => this.toast('Не удалось сохранить PNG: ' + err.message));
    }
    if (kind === 'print') this.printSchematic(m);
  }

  // печать схемы; в диалоге печати можно выбрать «Сохранить как PDF»
  printSchematic(m) {
    const e = AK.util.esc, title = e(this.project.name || 'Схема');
    const svg = AK.schematicStandaloneSVG(m, this.project.name).replace(/^<\?xml[^>]*>/, '');
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
      '<style>@page{size:A4 landscape;margin:10mm}html,body{margin:0}svg{width:100%;height:auto;max-height:180mm}h1{font:600 14px Arial,sans-serif;margin:0 0 6px}</style></head>' +
      `<body><h1>${title}</h1>${svg}</body></html>`);
    doc.close();
    setTimeout(() => {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (err) { this.toast('Печать недоступна: ' + err.message); }
      setTimeout(() => f.remove(), 1000);
    }, 200);
  }

  openFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const p = JSON.parse(r.result);
        if (!this.validate(p)) throw new Error('bad');
        this.checkpoint();
        this.project = p;
        this.select(null);
        this.changed();
        this.editor.fit();
        this.toast('Проект открыт');
      } catch (err) { this.toast('Не удалось открыть файл: это не проект AutoKiCad'); }
    };
    r.readAsText(file);
  }

  bindUI() {
    if (AK.EMBED) {
      const b = document.createElement('button');
      b.className = 'primary'; b.id = 'btnToEE';
      b.textContent = 'Создать схему в EasyEDA';
      b.addEventListener('click', () => this.sendToEasyEDA());
      document.querySelector('.actions').prepend(b);
      window.addEventListener('message', e => {
        if (e.data && e.data.akc === 'built') this.toast(e.data.ok ? 'Схема создана в EasyEDA' : 'Ошибка EasyEDA: ' + e.data.error);
      });
    }
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
    const $ = id => document.getElementById(id);
    $('btnNew').addEventListener('click', () => {
      if (this.project.components.length && !confirm('Очистить поле? Текущий проект можно вернуть через Ctrl+Z.')) return;
      this.checkpoint();
      this.project = AK.emptyProject();
      this.select(null);
      this.changed();
    });
    $('examplesMenu').innerHTML = AK.EXAMPLES.map(x => `<button data-example="${x.id}"><b>${AK.util.esc(x.name)}</b><small>${AK.util.esc(x.desc)}</small></button>`).join('');
    document.querySelectorAll('[data-example]').forEach(b => b.addEventListener('click', () => {
      this.loadExample(b.dataset.example);
      b.closest('.dropdown').classList.remove('open');
    }));
    $('btnOpen').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', e => { if (e.target.files[0]) this.openFile(e.target.files[0]); e.target.value = ''; });
    $('btnSave').addEventListener('click', () => this.exportAs('project'));
    document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => {
      this.exportAs(b.dataset.export);
      b.closest('.dropdown').classList.remove('open');
    }));
    const dds = [...document.querySelectorAll('.dropdown')];
    dds.forEach(dd => dd.querySelector(':scope > button').addEventListener('click', e => {
      e.stopPropagation();
      dds.forEach(o => { if (o !== dd) o.classList.remove('open'); });
      dd.classList.toggle('open');
    }));
    document.addEventListener('click', e => dds.forEach(dd => { if (!dd.contains(e.target)) dd.classList.remove('open'); }));

    const view = () => (this.tab === 'sch' ? this.schView : this.editor);
    $('zoomIn').addEventListener('click', () => view().zoomBy(1.25));
    $('zoomOut').addEventListener('click', () => view().zoomBy(1 / 1.25));
    $('zoomFit').addEventListener('click', () => view().fit());

    document.addEventListener('keydown', e => {
      if (e.target.matches('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'я')) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'н')) { e.preventDefault(); this.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'ы')) { e.preventDefault(); this.exportAs('project'); return; }
      if (this.tab === 'sch') return;
      const ed = this.editor, ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (k === 'd' || k === 'в')) { e.preventDefault(); ed.duplicateSelection(); return; }
      if (ctrl && (k === 'a' || k === 'ф')) { e.preventDefault(); ed.selectAll(); return; }
      if (ctrl && (k === 'c' || k === 'с')) { if (ed.copySelection()) { e.preventDefault(); this.toast('Скопировано'); } return; }
      if (ctrl && (k === 'x' || k === 'ч')) { if (ed.copySelection()) { e.preventDefault(); ed.deleteSelection(); } return; }
      if (ctrl && (k === 'v' || k === 'м')) { e.preventDefault(); ed.paste(); return; }
      const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[k]) { e.preventDefault(); const st = e.shiftKey ? 50 : 10; ed.nudge(arrows[k][0] * st, arrows[k][1] * st); return; }
      if (k === 'escape') { if (!this.editor.cancel()) { this.select(null); this.editor.render(); } return; }
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.editor.deleteSelection(); return; }
      if (k === 'r' || k === 'к') { this.editor.rotateSelection(); return; }
      const ci = '12345678'.indexOf(e.key);
      if (ci >= 0) { this.editor.wireColor = ci; this.toast('Цвет нового провода изменён'); }
    });
    window.addEventListener('resize', () => { this.editor.applyView(); if (this.tab !== 'board') this.schView.fit(); });
  }
};

// Новый проект начинается с пустой макетной платы
AK.emptyProject = function () {
  return { version: 1, name: 'Новый проект', components: [{ id: 'bb', type: 'breadboard', ref: 'BB1', value: '', x: 300, y: 250, rot: 0, props: {} }], wires: [] };
};

// Перечень элементов (BOM), как в EasyEDA: одинаковые детали — одной строкой. Разделитель «;» — для Excel.
AK.bomCSV = function (project) {
  const rows = new Map();
  project.components.forEach(c => {
    const d = AK.LIB[c.type];
    if (d.virtual) return;
    const value = c.value || d.value;
    const key = [c.type, value].join('|');
    if (!rows.has(key)) rows.set(key, { refs: [], value, name: d.name, pkg: d.eePackage || '', fp: d.footprint || '', lcsc: d.lcsc || '' });
    rows.get(key).refs.push(c.ref);
  });
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const out = [['№', 'Обозначения', 'Номинал', 'Наименование', 'Корпус', 'Посадочное место KiCad', 'Кол-во', 'LCSC'].map(q).join(';')];
  [...rows.values()].sort((a, b) => natural(a.refs.sort(natural)[0], b.refs.sort(natural)[0]))
    .forEach((r, i) => out.push([i + 1, r.refs.join(', '), r.value, r.name, r.pkg, r.fp, r.refs.length, r.lcsc].map(q).join(';')));
  return '﻿' + out.join('\r\n') + '\r\n';
};
