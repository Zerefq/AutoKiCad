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
    this.project = this.load() || AK.demoProject();
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
  netlist() {
    if (!this.nl) this.nl = AK.buildNetlist(this.project);
    return this.nl;
  }
  schematic() {
    if (!this.sch) this.sch = AK.generateSchematic(this.project, this.netlist());
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
    try { localStorage.setItem('autokicad.project.v2', JSON.stringify(this.project)); } catch (e) { /* хранилище недоступно */ }
  }
  load() {
    if (/demo/.test(location.search)) return null;
    try {
      const s = localStorage.getItem('autokicad.project.v2');
      if (!s) return null;
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
    let html = '<div class="pal-title">Компоненты</div><div class="pal-help">Перетащите на поле или кликните</div>';
    const libOk = AK.EE.available();
    html += `<div class="pal-cat">Библиотека EasyEDA / LCSC</div>
      <form class="ee-search" id="eeSearch"><input id="eeQuery" placeholder="NE555, 10k 0603, C25804…" ${libOk ? '' : 'disabled'}><button ${libOk ? '' : 'disabled'}>Найти</button></form>
      ${libOk ? '' : '<div class="pal-help">Поиск по библиотеке работает, когда AutoKiCad открыт из EasyEDA (расширение).</div>'}
      <div id="eeResults" class="ee-results"></div>
      <div class="ee-attr">Источник: JLCEDA/EasyEDA Official Library · <a href="https://lceda.cn/" target="_blank" rel="noopener">lceda.cn</a> · <a href="https://easyeda.com" target="_blank" rel="noopener">easyeda.com</a></div>
      <div id="palProject"></div>`;
    Object.entries(cats).forEach(([cat, list]) => {
      html += `<div class="pal-cat">${AK.util.esc(cat)}</div><div class="pal-grid">`;
      list.forEach(d => { html += this.palItem(d); });
      html += '</div>';
    });
    pal.innerHTML = html;
    this.bindPalItems(pal);
    this.palPartsKey = null;
    this.renderProjectParts();
    document.getElementById('eeSearch').addEventListener('submit', e => { e.preventDefault(); this.searchLibrary(document.getElementById('eeQuery').value.trim()); });
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
    const wire = sel && sel.kind === 'wire' ? this.project.wires.find(w => w.id === sel.id) : null;

    if (comp) {
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
        <li>Экспортируйте в KiCad или EasyEDA.</li></ol>
        <div class="muted small"><kbd>R</kbd> поворот · <kbd>Del</kbd> удалить · <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> отмена/повтор · колесо — масштаб · перетаскивание пустого места — сдвиг · <kbd>Shift</kbd>+клик при установке — поставить несколько</div>`;
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
    $('btnDemo').addEventListener('click', () => {
      this.checkpoint();
      this.project = AK.demoProject();
      this.select(null);
      this.changed();
      this.editor.fit();
    });
    $('btnOpen').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', e => { if (e.target.files[0]) this.openFile(e.target.files[0]); e.target.value = ''; });
    $('btnSave').addEventListener('click', () => this.exportAs('project'));
    document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => {
      this.exportAs(b.dataset.export);
      b.closest('.dropdown').classList.remove('open');
    }));
    const dd = document.querySelector('.dropdown');
    $('btnExport').addEventListener('click', e => { e.stopPropagation(); dd.classList.toggle('open'); });
    document.addEventListener('click', e => { if (!dd.contains(e.target)) dd.classList.remove('open'); });

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
      if ((e.ctrlKey || e.metaKey) && (k === 'd' || k === 'в')) { e.preventDefault(); this.editor.duplicateSelection(); return; }
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

// Пример: мигалка на NE555, собранная на макетной плате.
// Ножки стоят в отверстиях; провода — только перемычки между полосками.
AK.demoProject = function () {
  const C = (id, type, ref, value, x, y, rot, props) => ({ id, type, ref, value, x, y, rot: rot || 0, props: props || {} });
  const comps = [
    C('bb', 'breadboard', 'BB1', '', 300, 250),
    C('bt1', 'battery', 'BT1', '9V', 80, 200, 90),
    C('u1', 'ne555', 'U1', 'NE555', 305, 255),         // выводы 8,7,6,5 — e14…e17; 1,2,3,4 — f14…f17
    C('r1', 'resistor', 'R1', '1k', 260, 190, 90),     // шина + → c11
    C('r2', 'resistor', 'R2', '10k', 260, 270, 90),    // e11 → i11, через канавку
    C('c1', 'electrolytic', 'C1', '10u', 320, 180),    // + a16 (THR), − a18
    C('r3', 'resistor', 'R3', '330', 340, 300),        // i16 (Q) → i22
    C('d1', 'led', 'D1', 'LED', 380, 250, 0, { color: 'red' }), // анод f22, катод f24
  ];
  const RED = '#e53935', BLK = '#212121', BLU = '#1e88e5', GRN = '#43a047';
  const W = (id, fc, fp, tc, tp, color, points) => ({ id, from: { c: fc, p: fp }, to: { c: tc, p: tp }, points: points || [], color, net: '' });
  const J = (id, a, b, color, points) => W(id, 'bb', a, 'bb', b, color, points);
  const wires = [
    W('w1', 'bt1', '1', 'bb', 'TP1', RED),
    W('w2', 'bt1', '2', 'bb', 'TN1', BLK, [[100, 240], [100, 170]]),
    J('w3', 'TP29', 'BP29', RED, [[495, 160], [495, 350]]),
    J('w4', 'TN29', 'BN29', BLK, [[485, 170], [485, 340]]),
    J('w5', 'a14', 'TP14', RED),   // VCC (8)
    J('w6', 'j17', 'BP17', RED),   // R (4)
    J('w7', 'j14', 'BN14', BLK),   // GND (1)
    J('w8', 'd15', 'd11', BLU),    // DIS (7) → R1, R2
    J('w9', 'd16', 'g15', GRN),    // THR (6) ↔ TR (2), над корпусом
    J('w10', 'j11', 'h15', GRN),   // R2 → TR (2)
    J('w11', 'b18', 'TN20', BLK),  // C1 − → GND
    J('w12', 'j24', 'BN25', BLK),  // катод LED → GND
  ];
  return { version: 1, name: 'Мигалка на NE555', components: comps, wires };
};
