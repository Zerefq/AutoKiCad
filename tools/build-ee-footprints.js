// Сборка js/ee-footprints.js: для каждого посадочного места KiCad из js/footprints.js —
// такое же посадочное место из библиотеки EasyEDA (имя и uuid на сервере).
// Нужно для «Конвертировать в печатную плату» в EasyEDA: без uuid посадочного места
// EasyEDA пишет «Не удается найти посадочное место на сервере».
// Совпадение проверяется по расположению площадок (с точностью до поворота), заодно строится
// соответствие номеров площадок KiCad → EasyEDA.
// Запуск: node tools/build-ee-footprints.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const API = 'https://easyeda.com', VER = '6.5.51', LCSC_UID = '0819f05c4eef4c71ace90d822a990e87';

const ctx = { console, Math, JSON, Date, Set, Map, Object, Array, String, Number, RegExp, isFinite, Infinity, NaN, parseFloat, URLSearchParams };
ctx.window = ctx;
vm.createContext(ctx);
['util', 'footprints', 'easyeda-lib'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx));
const AK = ctx.AK;

// что искать в библиотеке EasyEDA для каждого посадочного места (по порядку, до первого совпадения)
const Q = {
  'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal': ['R_AXIAL-0.4'],
  'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal': ['R_AXIAL-0.3'],
  'Resistor_THT:R_Axial_DIN0204_L3.6mm_D1.6mm_P7.62mm_Horizontal': ['R_AXIAL-0.3'],
  'Resistor_THT:R_Axial_DIN0204_L3.6mm_D1.6mm_P2.54mm_Vertical': ['RES-TH_BD1.8-P2.54', 'RES-TH_BD2.0-P2.54', 'RES-TH_BD1.6-P2.54', 'RES-TH_BD2.4-P2.54', 'R_AXIAL-0.1'],
  'Resistor_SMD:R_0805_2012Metric': ['R0805'],
  'Resistor_SMD:R_0603_1608Metric': ['R0603'],
  'Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm': ['CAP-TH_L5.0-W2.5-P5.00'],
  'Capacitor_THT:C_Disc_D3.0mm_W1.6mm_P2.50mm': ['CAP-TH_L3.0-W1.6-P2.50', 'CAP-TH_L4.0-W2.5-P2.50', 'CAP-TH_L3.5-W2.5-P2.50', 'P2.50-D0.5'],
  'Capacitor_SMD:C_0805_2012Metric': ['C0805'],
  'Capacitor_SMD:C_0603_1608Metric': ['C0603'],
  'Capacitor_THT:CP_Radial_D5.0mm_P2.00mm': ['CAP-TH_BD5.0-P2.00'],
  'Capacitor_THT:CP_Radial_D6.3mm_P2.50mm': ['CAP-TH_BD6.3-P2.50'],
  'Capacitor_THT:CP_Radial_D8.0mm_P3.50mm': ['CAP-TH_BD8.0-P3.50'],
  'Capacitor_SMD:CP_Elec_5x5.4': ['CAP-SMD_BD5.0-L5.3-W5.3', 'CAP-SMD_BD5.0'],
  'LED_THT:LED_D5.0mm': ['LED-TH_BD5.0-P2.54-FD', 'LED-TH_BD5.0-P2.54', 'LED-TH_BD5.0'],
  'LED_THT:LED_D3.0mm': ['LED-TH_BD3.0-P2.54-FD', 'LED-TH_BD3.0-P2.54', 'LED-TH_BD3.0'],
  'LED_SMD:LED_0805_2012Metric': ['LED0805-RD', 'LED0805'],
  'LED_SMD:LED_1206_3216Metric': ['LED1206-RD', 'LED1206'],
  'Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal': ['DO-41_BD2.4-L4.7-P10.16', 'DO-41_BD2.7-L5.2-P10.2', 'DO-41'],
  'Diode_THT:D_DO-41_SOD81_P7.62mm_Horizontal': ['DO-41_BD2.4-L4.7-P7.62', 'DO-41_BD1.9-L3.3-P7.30', 'DO-41'],
  'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal': ['DO-35_BD1.8-L4.1-P7.62', 'DO-35_BD1.7-L3.8-P7.8', 'DO-35'],
  'Diode_THT:D_DO-35_SOD27_P10.16mm_Horizontal': ['DO-35_BD1.7-L3.6-P10.00', 'DO-35'],
  'Diode_SMD:D_SMA': ['SMA_L4.3-W2.6-LS5.2-RD', 'SMA_L4.3-W2.6', 'DO-214AC'],
  'Diode_SMD:D_MiniMELF': ['MINIMELF'],
  'Package_TO_SOT_THT:TO-92_Inline': ['TO-92-3_L4.8-W3.7-P1.27-L', 'TO-92-3_L4.9-W3.7-P1.27-L', 'TO-92-3_L4.6-W3.9-P1.27-L', 'TO-92-3'],
  'Package_TO_SOT_THT:TO-220-3_Vertical': ['TO-220-3_L10.0-W4.5-P2.54-L', 'TO-220-3_L10.0-W4.5-P2.54-T', 'TO-220-3'],
  'Crystal:Crystal_HC49-4H_Vertical': ['HC-49US_L11.0-W4.6-P4.88', 'HC-49U', 'HC-49S'],
  'OptoDevice:R_LDR_5.1x4.3mm_P3.4mm_Vertical': ['RES-TH_L5.1-W4.3-P3.40', 'LDR', 'GL55', 'PHOTORESISTOR'],
  'Button_Switch_THT:SW_Slide_SPDT_Straight_CK_OS102011MS2Q': ['OS102011MS2Q', 'SW-TH_OS102011'],
  'Button_Switch_THT:SW_PUSH_6mm': ['SW-TH_4P-L6.0-W6.0-P4.50-LS6.5', 'KEY-TH_4P-L6.0-W6.0-P4.50-LS6.5', 'SW-TH_4P-L6.0-W6.0', 'KEY-TH_4P-L6.0-W6.0'],
  'Button_Switch_THT:SW_PUSH_6mm_H5mm': ['SW-TH_4P-L6.0-W6.0-P4.50-LS6.5', 'KEY-TH_4P-L6.0-W6.0-P4.50-LS6.5', 'SW-TH_4P-L6.0-W6.0', 'KEY-TH_4P-L6.0-W6.0'],
  'Button_Switch_SMD:SW_SPST_TL3342': ['TL3342', 'SW-SMD_4P-L4.2-W3.2'],
  'Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical': ['RES-ADJ-TH_3386P', '3386P'],
  'Buzzer_Beeper:Buzzer_12x9.5RM7.6': ['BUZ-TH_BD12.0-P7.60', 'BUZZER-TH_BD12.0-P7.60', 'BUZ-TH_BD12', 'BUZZER-TH'],
  'Package_DIP:DIP-8_W7.62mm': ['DIP-8_L9.8-W6.4-P2.54-LS7.6-BL', 'DIP-8_L9.3-W6.5-P2.54-LS7.6-BL', 'DIP-8'],
  'LED_SMD:LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm': ['LED-SMD_4P-L5.0-W5.0-TL_WS2812B', 'LED-SMD_4P-L5.0-W5.0_WS2812B', 'WS2812B'],
  'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12': ['USB-C-SMD_TYPE-C-31-M-12', 'USB-C_SMD-TYPE-C-31-M-12', 'TYPE-C-31-M-12'],
  'MountingHole:MountingHole_2.2mm_M2_Pad': ['TH_BD4.0-D2.2', 'SMD-1_BD4.0-D2.2', 'TH-1_BD4.0-D2.2', 'HOLE-TH_D2.2', 'MountingHole_2.2mm_M2_Pad', 'M2_HOLE', 'HOLE_M2'],
  'MountingHole:MountingHole_3.2mm_M3_Pad': ['TH_BD6.0-D3.2', 'TH-1_BD6.0-D3.2', 'SMD-1_BD6.4-D3.2', 'TH_BD6.4-D3.2', 'HOLE-TH_D3.2', 'MountingHole_3.2mm_M3_Pad', 'M3_HOLE', 'HOLE_M3'],
  'TestPoint:TestPoint_THTPad_D3.0mm_Drill1.5mm': ['TESTPOINT-TH_BD3.0-D1.5', 'TESTPOINT-TH_D3.0', 'TP-TH_D3.0', 'TestPoint_THTPad_D3.0mm_Drill1.5mm', 'TP-1.5MM'],
  'TestPoint:TestPoint_THTPad_D4.0mm_Drill2.0mm': ['TESTPOINT-TH_BD4.0-D2.0', 'TESTPOINT-TH_D4.0', 'TP-TH_D4.0', 'TestPoint_THTPad_D4.0mm_Drill2.0mm', 'TP-2.0MM'],
  'Module:Arduino_Nano': ['ARDUINO-NANO', 'ARDUINO_NANO', 'Arduino Nano'],
  'Inductor_THT:L_Axial_L5.3mm_D2.2mm_P10.16mm_Horizontal_Vishay_IM-1': ['L_AXIAL-0.4'],
};
for (let n = 2; n <= 8; n++) Q[`Connector_PinHeader_2.54mm:PinHeader_1x0${n}_P2.54mm_Vertical`] = [`HDR-M-2.54_1X${n}`];

const post = (url, data) => fetch(API + url, { method: 'POST', body: new URLSearchParams(data) }).then(r => r.json());
const get = url => fetch(API + url).then(r => r.json());
const scache = new Map();
async function search(wd) {
  if (scache.has(wd)) return scache.get(wd);
  const r = await post('/api/components/search', { type: '3', 'doctype[]': '4', uid: LCSC_UID, returnListStyle: 'classifyarr', wd, version: VER });
  const L = (r.result && r.result.lists) || {};
  const list = [].concat(...Object.values(L).filter(Array.isArray)).filter(x => x.docType === 4);
  scache.set(wd, list);
  return list;
}
const cache = new Map();
async function fetchFp(uuid) {
  if (!cache.has(uuid)) {
    const r = await get(`/api/components/${uuid}?version=${VER}&uuid=${uuid}`);
    cache.set(uuid, r.success && r.result && r.result.dataStr ? AK.EE.fpFromPackage(r.result.dataStr) : null);
  }
  return cache.get(uuid);
}

// площадки с медью и номером; координаты — от центра рамки площадок
function norm(pads) {
  const P = pads.filter(p => p.k !== 'np_thru_hole' && p.n !== '');
  if (!P.length) return P;
  const xs = P.map(p => p.x), ys = P.map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return P.map(p => ({ n: String(p.n), th: p.k === 'thru_hole', d: Array.isArray(p.d) ? Math.min(...p.d) : (p.d || 0), s: Math.max(p.w, p.h), x: p.x - cx, y: p.y - cy }));
}
const ROT = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0]];
// соответствие площадок KiCad → EasyEDA, если расположение совпадает (с точностью до поворота на 90°);
// strict — ещё и размер площадок близок, а допуск по положению меньше
function match(ki, ee, strict) {
  const tol = strict ? 0.15 : 0.3;
  const A = norm(ki), B = norm(ee);
  if (!A.length || A.length !== B.length) return null;
  let best = null;
  ROT.forEach(([a, b, c, d]) => {
    const map = {}, used = new Set();
    let ok = true, same = 0;
    for (const p of A) {
      const x = a * p.x + b * p.y, y = c * p.x + d * p.y;
      const q = B.find((q, i) => !used.has(i) && q.th === p.th && Math.abs(q.d - p.d) < 0.3 && (!strict || Math.abs(q.s - p.s) < 0.6) && Math.hypot(q.x - x, q.y - y) < tol && used.add(i));
      if (!q) { ok = false; break; }
      (map[p.n] = map[p.n] || new Set()).add(q.n);
      if (q.n === p.n) same++;
    }
    if (!ok) return;
    // одна площадка EasyEDA не может принадлежать двум разным выводам KiCad
    const owner = {};
    for (const [k, s] of Object.entries(map)) for (const n of s) { if (owner[n] && owner[n] !== k) return; owner[n] = k; }
    if (!best || same > best.same) best = { same, map };
  });
  return best;
}

(async () => {
  const out = {}, miss = [];
  for (const name of Object.keys(AK.FOOTPRINTS).sort()) {
    const ki = AK.FOOTPRINTS[name].pads, qs = Q[name] || [name.split(':').pop()];
    let found = null;
    // сначала строгое совпадение по всем запросам, затем с бóльшим допуском
    for (const strict of [true, false]) for (const wd of qs) {
      if (found) break;
      const list = await search(wd);
      // сначала точное имя, затем короткие (общие) имена
      list.sort((x, y) => (y.title === wd) - (x.title === wd) || y.title.startsWith(wd) - x.title.startsWith(wd) || x.title.length - y.title.length);
      for (const c of list.slice(0, 25)) {
        const fp = await fetchFp(c.uuid);
        const m = fp && match(ki, fp.pads, strict);
        if (m) { found = { t: c.title, u: c.uuid, m }; break; }
      }
    }
    if (!found) { miss.push(name); console.log('—', name); continue; }
    const same = Object.entries(found.m.map).every(([k, s]) => s.size === 1 && s.has(k));
    out[name] = { t: found.t, u: found.u };
    if (!same) out[name].map = Object.fromEntries(Object.entries(found.m.map).map(([k, s]) => [k, [...s]]));
    console.log('✓', name, '→', found.t, same ? '' : JSON.stringify(out[name].map));
  }
  const head = `// Посадочные места библиотеки EasyEDA, совпадающие с посадочными местами KiCad из js/footprints.js
// (сгенерировано tools/build-ee-footprints.js). t — имя, u — uuid на сервере EasyEDA,
// map — номера площадок KiCad → EasyEDA, если они различаются. Нужно для «Конвертировать в печатную плату».
// Источник: JLCEDA/EasyEDA Official Library, https://easyeda.com
window.AK = window.AK || {};
AK.EE_FOOTPRINTS = `;
  fs.writeFileSync(path.join(ROOT, 'js', 'ee-footprints.js'), head + JSON.stringify(out, null, 0).replace(/\},"/g, '},\n"') + ';\n');
  console.log(`\nнайдено ${Object.keys(out).length}, нет ${miss.length}`);
})();
