// AutoKiCad для EasyEDA Standard: монтаж на макетной плате → принципиальная схема.
// Окно макетки — ui.html (собирается из исходников AutoKiCad), открывается поверх редактора.
(function () {
  var overlay = null, frame = null;

  function open() {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'autokicad-overlay';
      overlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:9000;background:rgba(20,30,40,.45);display:flex;padding:18px;box-sizing:border-box';
      var box = document.createElement('div');
      box.style.cssText = 'flex:1;display:flex;flex-direction:column;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.4)';
      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 10px 6px 14px;background:#1565c0;color:#fff;font:600 14px Arial,sans-serif';
      bar.innerHTML = '<span style="flex:1">AutoKiCad — монтаж на макетной плате</span>';
      var btn = document.createElement('button');
      btn.textContent = '✕';
      btn.title = 'Свернуть (проект сохраняется)';
      btn.style.cssText = 'border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer;padding:0 6px';
      btn.onclick = close;
      bar.appendChild(btn);
      frame = document.createElement('iframe');
      frame.style.cssText = 'flex:1;border:0;width:100%';
      // EasyEDA не принимает .html в расширениях — страница лежит в ui.txt и подставляется через srcdoc
      // (у srcdoc тот же источник, что у редактора: работают библиотека EasyEDA и localStorage)
      fetch(api('getRes', { file: 'ui.txt' })).then(function (r) { return r.text(); }).then(function (html) { frame.srcdoc = html; });
      box.appendChild(bar);
      box.appendChild(frame);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
  }
  function close() { if (overlay) overlay.style.display = 'none'; }
  function reply(msg) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); }

  function compress() {
    var c = api('getSource', { type: 'compress' });
    return typeof c === 'string' ? JSON.parse(c) : c;
  }

  // Шаг 1: новая схема с «родными» символами библиотеки в исходных координатах.
  // Шаг 2: каждый символ сдвигается на своё место (moveObjs пересчитывает все его фигуры).
  // Шаг 3: в документ добавляются провода, символы питания, метки и встроенные компоненты.
  function build(p) {
    // метка нового документа: ждём, пока активной станет именно новая схема
    // (без неё при проекте без деталей библиотеки провода могли попасть в предыдущий документ)
    var token = 'akc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    p.libDoc.head.c_para = Object.assign({}, p.libDoc.head.c_para, { AutoKiCadBuild: token });
    try {
      api('applySource', { source: p.libDoc, createNew: true });
    } catch (e) { reply({ akc: 'built', ok: false, error: String(e) }); return; }
    var need = p.moves.length, tries = 0;
    var iv = setInterval(function () {
      tries++;
      try {
        var c = compress();
        var mine = c && c.head && (c.head.c_para || {}).AutoKiCadBuild === token;
        var libs = (c && c.shape || []).filter(function (s) { return s.indexOf('LIB~') === 0; });
        if (!mine || libs.length < need) { if (tries > 80) { clearInterval(iv); reply({ akc: 'built', ok: false, error: 'EasyEDA не открыла новую схему' }); } return; }
        clearInterval(iv);
        // EasyEDA присваивает свои id — находим символы по обозначению (pre)
        var byRef = {};
        libs.forEach(function (s) {
          var f = s.split('#@$')[0].split('~'), m = /(?:^|`)pre`([^`]*)`/.exec(f[3] || '');
          if (m) byRef[m[1]] = f[6];
        });
        p.moves.forEach(function (m) {
          var id = byRef[m.ref];
          if (id && (m.dx || m.dy)) api('moveObjs', { objs: [id], addX: m.dx, addY: m.dy });
        });
        var doc = compress();
        if (doc.head && doc.head.c_para) delete doc.head.c_para.AutoKiCadBuild;
        doc.shape = doc.shape.concat(p.rest);
        if (p.canvas) doc.canvas = p.canvas;
        api('applySource', { source: doc });
        reply({ akc: 'built', ok: true });
        close();
      } catch (e) { clearInterval(iv); reply({ akc: 'built', ok: false, error: String(e && e.message || e) }); }
    }, 250);
  }

  // Плата: новый документ платы с контуром, посадочными местами и цепями на площадках.
  // Связи (ratlines) EasyEDA строит сама по именам цепей; дорожки — автотрассировкой или вручную.
  function buildPcb(doc) {
    try {
      api('applySource', { source: doc, createNew: true });
      reply({ akc: 'built', ok: true, kind: 'pcb' });
      close();
    } catch (e) { reply({ akc: 'built', ok: false, kind: 'pcb', error: String(e && e.message || e) }); }
  }

  window.addEventListener('message', function (e) {
    if (!frame || e.source !== frame.contentWindow || !e.data || !e.data.akc) return;
    if (e.data.akc === 'build') build(e.data.payload);
    if (e.data.akc === 'buildPcb') buildPcb(e.data.payload);
    if (e.data.akc === 'close') close();
  });

  api('createCommand', {
    'extension-autokicad-open': open,
  });
  api('createExtensionMenu', [{ text: 'AutoKiCad: макетная плата', cmd: 'extension-autokicad-open' }]);
  api('createToolbarButton', {
    icon: api('getRes', { file: 'icon.svg' }),
    title: 'AutoKiCad: макетная плата → схема',
    cmd: 'extension-autokicad-open',
  });
})();
