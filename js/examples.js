// Примеры проектов (меню «Примеры»). Все собраны на макетной плате:
// компоненты ставятся ножкой в отверстие по имени (a1…j30, TP/TN/BP/BN — шины), провода — перемычки.
window.AK = window.AK || {};

(function () {
  const RED = '#e53935', BLK = '#212121', BLU = '#1e88e5', GRN = '#43a047', YEL = '#fdd835', ORG = '#fb8c00';

  // конструктор проекта: плата BB1 в (300, 250); boardType — breadboard или breadboard_full
  function builder(name, boardType, bx) {
    const bb = { id: 'bb', type: boardType || 'breadboard', ref: 'BB1', value: '', x: bx || 300, y: 250, rot: 0, props: {} };
    const P = { version: 1, name, components: [bb], wires: [] };
    const boards = { bb };
    let wn = 0;
    return {
      P,
      // ещё одна макетная плата
      board(id, type, ref, x, y) {
        const c = { id, type, ref, value: '', x, y, rot: 0, props: {} };
        P.components.push(c);
        boards[id] = c;
        return c;
      },
      // компонент вывод pin (по умолчанию первый) — в отверстие hole (платы boardId, по умолчанию BB1)
      put(id, type, ref, value, hole, rot, props, pinId, boardId) {
        const d = AK.LIB[type];
        const p = d.visual.pins[pinId || Object.keys(d.visual.pins)[0]];
        const [hx, hy] = AK.pinWorld(boards[boardId || 'bb'], hole);
        const [rx, ry] = AK.util.rotPt(p[0], p[1], rot || 0);
        const c = { id, type, ref, value, x: hx - rx, y: hy - ry, rot: rot || 0, props: props || {} };
        P.components.push(c);
        return c;
      },
      // компонент вне платы — в точке (x, y)
      at(id, type, ref, value, x, y, rot, props) {
        const c = { id, type, ref, value, x, y, rot: rot || 0, props: props || {} };
        P.components.push(c);
        return c;
      },
      wire(fc, fp, tc, tp, color, points, net) {
        P.wires.push({ id: 'w' + (++wn), from: { c: fc, p: fp }, to: { c: tc, p: tp }, points: points || [], color, net: net || '' });
      },
      // перемычка между отверстиями платы (boardId — другая плата; to — плата второго конца)
      jump(a, b, color, points, net, boardId, toBoard) { this.wire(boardId || 'bb', a, toBoard || boardId || 'bb', b, color, points, net); },
      // деталь на печатной плате: центр площадок (cx, cy) в мм, поворот по часовой
      pcb(id, cx, cy, rot) {
        const c = P.components.find(x => x.id === id);
        const fp = AK.FOOTPRINTS[c.fp || AK.LIB[c.type].footprint];
        const xs = fp.pads.map(p => p.x), ys = fp.pads.map(p => p.y);
        const [ox, oy] = AK.PCB.rot((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, rot || 0);
        P.pcb = P.pcb || { shape: { type: 'auto' }, color: 'green', parts: {}, texts: [] };
        P.pcb.parts[id] = { x: Math.round((cx - ox) * 1000) / 1000, y: Math.round((cy - oy) * 1000) / 1000, rot: rot || 0 };
      },
      // батарея 9V слева, подключена к верхним шинам
      battery() {
        this.at('bt1', 'battery', 'BT1', '9V', 80, 200, 90);
        this.wire('bt1', '1', 'bb', 'TP1', RED);
        this.wire('bt1', '2', 'bb', 'TN1', BLK, [[100, 240], [100, 170]]);
      },
      // верхние шины соединены с нижними (справа)
      bridge() {
        this.jump('TP29', 'BP29', RED, [[495, 160], [495, 350]]);
        this.jump('TN29', 'BN29', BLK, [[485, 170], [485, 340]]);
      },
    };
  }

  // Мигалка на NE555 (выводы 8,7,6,5 — e14…e17; 1,2,3,4 — f14…f17)
  function blinker() {
    const b = builder('Мигалка на NE555');
    b.battery();
    b.put('u1', 'ne555', 'U1', 'NE555', 'f14');
    b.put('r1', 'resistor', 'R1', '1k', 'TP11', 90);   // шина + → c11
    b.put('r2', 'resistor', 'R2', '10k', 'e11', 90);   // e11 → i11, через канавку
    b.put('c1', 'electrolytic', 'C1', '10u', 'a16');   // + a16 (THR), − a18
    b.put('r3', 'resistor', 'R3', '330', 'i16');       // i16 (Q) → i22
    b.put('d1', 'led', 'D1', 'LED', 'f22', 0, { color: 'red' }, '2'); // анод f22, катод f24
    b.jump('TP29', 'BP29', RED, [[495, 160], [495, 350]]);
    b.jump('TN29', 'BN29', BLK, [[485, 170], [485, 340]]);
    b.jump('a14', 'TP14', RED);   // VCC (8)
    b.jump('j17', 'BP17', RED);   // R (4)
    b.jump('j14', 'BN14', BLK);   // GND (1)
    b.jump('d15', 'd11', BLU);    // DIS (7) → R1, R2
    b.jump('d16', 'g15', GRN);    // THR (6) ↔ TR (2), над корпусом
    b.jump('j11', 'h15', GRN);    // R2 → TR (2)
    b.jump('b18', 'TN20', BLK);   // C1 − → GND
    b.jump('j24', 'BN25', BLK);   // катод LED → GND
    return b.P;
  }

  // Светодиод с резистором — самая простая схема
  function ledBasic() {
    const b = builder('Светодиод с резистором');
    b.battery();
    b.put('r1', 'resistor', 'R1', '1k', 'TP5', 90);                       // шина + → c5
    b.put('d1', 'led', 'D1', 'LED', 'd5', 180, { color: 'green' }, '2');  // анод d5, катод d3
    b.jump('b3', 'TN3', BLK);
    return b.P;
  }

  // Кнопка включает светодиод через транзистор
  function transistorSwitch() {
    const b = builder('Транзисторный ключ с кнопкой');
    b.battery();
    b.bridge();
    b.put('sw1', 'button', 'SW1', 'BTN', 'e11');                           // e11 — e15
    b.jump('a11', 'TP11', RED);
    b.put('r1', 'resistor', 'R1', '10k', 'd15', 90);                       // d15 → h15
    b.put('q1', 'npn', 'Q1', 'BC547', 'f20');                              // C f20, B f21, E f22
    b.jump('g15', 'g21', GRN);                                             // R1 → база
    b.jump('j22', 'BN22', BLK);                                            // эмиттер → GND
    b.put('r2', 'resistor', 'R2', '330', 'h20');                           // коллектор h20 → h26
    b.put('d1', 'led', 'D1', 'LED', 'i24', 0, { color: 'yellow' }, '2');   // анод i24, катод i26
    b.jump('j24', 'BP25', RED);                                            // анод → + (BP24 нет: шина идёт группами по 5)
    return b.P;
  }

  // Стабилизатор 7805: 9 В с батареи → +5 В на верхней шине, светодиод-индикатор
  function regulator() {
    const b = builder('Стабилизатор 5 В на 7805');
    b.at('bt1', 'battery', 'BT1', '9V', 80, 310, 270);
    b.wire('bt1', '1', 'bb', 'BP1', RED);
    b.wire('bt1', '2', 'bb', 'BN1', BLK, [[100, 270], [100, 340]]);
    b.put('u1', 'reg78', 'U1', 'L7805', 'f13');                            // IN f13, GND f14, OUT f15
    b.jump('j13', 'BP13', RED);                                            // вход ← 9 В
    b.jump('j14', 'BN14', BLK);
    b.jump('h15', 'TP17', ORG, [[315, 290], [315, 160]], '+5V');           // выход → верхняя шина +5V
    b.jump('TN29', 'BN29', BLK, [[485, 170], [485, 340]]);
    b.put('c1', 'electrolytic', 'C1', '10u', 'a22', 180);                  // + a22, − a20
    b.jump('b22', 'TP22', RED);
    b.jump('b20', 'TN20', BLK);
    b.put('r1', 'resistor', 'R1', '330', 'TP5', 90);
    b.put('d1', 'led', 'D1', 'LED', 'd5', 180, { color: 'blue' }, '2');
    b.jump('b3', 'TN3', BLK);
    return b.P;
  }

  // Arduino Nano мигает светодиодом на D13
  function nanoBlink() {
    const b = builder('Arduino Nano: мигание D13');
    b.put('a1', 'nano', 'A1', 'Arduino_Nano', 'g8', 0, {}, '16');          // D13 — g8, верхний ряд выводов — c8…c22
    b.jump('b19', 'TN19', BLK);                                            // GND Arduino → шина −
    b.jump('j8', 'j25', GRN);                                              // D13 → R1
    b.put('r1', 'resistor', 'R1', '330', 'd25', 90, {}, '1');              // d25 → h25
    b.put('d1', 'led', 'D1', 'LED', 'e25', 0, { color: 'red' }, '2');      // анод e25, катод e27
    b.jump('d27', 'TN28', BLK, [[430, 230]]);
    return b.P;
  }

  // Сумеречный выключатель: стемнело — светодиод загорается
  function nightLight() {
    const b = builder('Сумеречный выключатель (фоторезистор)');
    b.battery();
    b.bridge();
    b.put('rv1', 'pot', 'RV1', '10k', 'b5', 180);                          // b5, b4 (движок), b3; корпус вниз
    b.jump('a5', 'TP5', RED);
    b.jump('c4', 'c6', GRN);                                               // движок → фоторезистор
    b.put('r1', 'ldr', 'R1', 'GL5528', 'b8', 180);                         // b8 — b6
    b.jump('a8', 'TN8', BLK);
    b.jump('a6', 'g17', BLU, [[210, 185], [340, 185], [340, 280]]);        // середина делителя → база
    b.put('q1', 'npn', 'Q1', 'BC547', 'f16');                              // C f16, B f17, E f18
    b.jump('j18', 'BN17', BLK);
    b.put('r2', 'resistor', 'R2', '330', 'h16');                           // коллектор h16 → h22
    b.put('d1', 'led', 'D1', 'LED', 'i20', 0, { color: 'white' }, '2');    // анод i20, катод i22
    b.jump('j20', 'BP20', RED);
    return b.P;
  }

  // Example_Heart — плата-сердце по фото: ATtiny85, 11 адресных светодиодов WS2812B по контуру, две кнопки,
  // USB-C (питание + D+/D− как у Digispark: 68 Ом, стабилитроны 3.6 В, подтяжка 1.5 кОм), отверстия GND и +5V.
  // На макетке: BB1 — логика и USB, BB2 — цепочка светодиодов. На печатной плате — расстановка как на фото.
  function heart() {
    const b = builder('Example_Heart', 'breadboard_full', 450);
    // ---------- BB1: USB-C, микроконтроллер, кнопки ----------
    b.put('usb1', 'usbc', 'USB1', 'USB-C', 'j1');                        // CC1 j1, VBUS j2, GND j3, CC2 j4, D− j5, D+ j6
    b.put('r7', 'resistor', 'R7', '5.1k', 'e1', 90);                      // CC1 → GND (через a1 → шина −)
    b.jump('a1', 'TN1', BLK);
    b.jump('f2', 'TP2', RED);                                             // VBUS → шина +
    b.jump('f3', 'TN3', BLK);                                             // GND → шина −
    b.put('r8', 'resistor', 'R8', '5.1k', 'e4', 90);                      // CC2 → GND
    b.jump('a4', 'TN4', BLK);
    b.jump('g5', 'g13', BLU);                                             // D− → R4 / R5
    b.jump('f6', 'f20', GRN);                                             // D+ → R3
    b.put('r5', 'resistor', 'R5', '1.5k', 'h13', 90);                     // подтяжка D− к +5V (h13 → BP13)
    b.put('r4', 'resistor', 'R4', '68', 'i13');                           // i13 → i19
    b.put('r3', 'resistor', 'R3', '68', 'g20');                           // g20 → g26
    b.jump('j19', 'j41', BLU);                                            // D− → PB3
    b.jump('h26', 'h42', GRN);                                            // D+ → PB4
    b.put('u1', 'attiny85', 'U1', 'ATtiny85', 'f40');                     // 1 PB5 f40, 2 PB3 f41, 3 PB4 f42, 4 GND f43; 8 VCC e40 … 5 PB0 e43
    b.jump('a40', 'TP40', RED);                                           // VCC
    b.jump('j43', 'BN43', BLK);                                           // GND
    b.put('d2', 'zener', 'D2', 'BZX55C3V6', 'g41', 180, {}, '1');         // PB3 → стабилитрон → GND (катод g41, анод g47)
    b.put('d1', 'zener', 'D1', 'BZX55C3V6', 'i42', 180, {}, '1');         // PB4 (катод i42, анод i48)
    b.jump('j47', 'BN47', BLK);
    b.jump('j48', 'BN49', BLK);
    b.put('r2', 'resistor', 'R2', '1k', 'c41', 180);                      // PB2 → R2 → SW2
    b.put('sw2', 'button', 'SW2', 'BTN', 'e31');                          // e31 — e35
    b.jump('a31', 'TN31', BLK);
    b.put('r1', 'resistor', 'R1', '1k', 'c42');                           // PB1 → R1 → SW1
    b.put('sw1', 'button', 'SW1', 'BTN', 'e48');                          // e48 — e52
    b.jump('a52', 'TN52', BLK);
    b.put('h1', 'mhole', 'H1', 'GND', 'TN25', 0, {});                     // контакты-отверстия GND и +5V
    b.put('h2', 'mhole', 'H2', '+5V', 'TP27', 0, {});
    b.jump('TP59', 'BP59', RED, [[790, 160], [790, 350]]);
    b.jump('TN59', 'BN59', BLK, [[780, 170], [780, 340]]);
    // ---------- BB2: 11 светодиодов WS2812B цепочкой DOUT → DIN ----------
    b.board('bb2', 'breadboard_full', 'BB2', 450, 540);
    b.put('r6', 'resistor', 'R6', '330', 'j1', 0, {}, '1', 'bb2');        // PB0 → R6 → DIN первого светодиода
    b.jump('a43', 'h1', ORG, [[580, 185], [130, 185], [130, 580]], '', 'bb', 'bb2');
    const rail = (p, col) => p + (col % 6 === 0 ? col - 1 : col);         // в шине нет каждого 6-го отверстия
    for (let k = 1; k <= 11; k++) {
      const c = 7 + (k - 1) * 5;                                          // DIN c, VDD c+1, GND c+2, DOUT c+3
      b.put('led' + k, 'ws2812b', 'LED' + k, 'WS2812B', 'f' + c, 0, {}, '4', 'bb2');
      b.jump('h' + (c + 1), rail('BP', c + 1), RED, [], '', 'bb2');
      b.jump('i' + (c + 2), rail('BN', c + 2), BLK, [], '', 'bb2');
      if (k < 11) b.jump('g' + (c + 3), 'g' + (c + 5), YEL, [], '', 'bb2');
    }
    // питание BB2 — с нижних шин BB1, справа от плат
    b.jump('BP57', 'BP57', RED, [[810, 350], [810, 640]], '', 'bb', 'bb2');
    b.jump('BN58', 'BN58', BLK, [[800, 340], [800, 630]], '', 'bb', 'bb2');

    // ---------- печатная плата: сердце 48.6 × 48.5 мм, расстановка по фото ----------
    const P = b.P;
    P.components.forEach(c => {
      if (c.type === 'resistor') c.fp = 'Resistor_THT:R_Axial_DIN0204_L3.6mm_D1.6mm_P7.62mm_Horizontal';
      if (c.type === 'zener') c.fp = 'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal';
      if (c.type === 'mhole') c.fp = 'TestPoint:TestPoint_THTPad_D3.0mm_Drill1.5mm';
    });
    const X = dx => 24.3 + dx;                                            // ось симметрии сердца
    [[1, -11.0, 37.6, 45], [2, -17.4, 29.6, 45], [3, -21.3, 18.5, 90], [4, -18.3, 8.1, 30], [5, -7.6, 8.4, 45], [6, 0, 15.3, 0],
      [7, 7.6, 8.4, -45], [8, 18.3, 8.1, -30], [9, 21.3, 18.5, 90], [10, 17.4, 29.6, -45], [11, 11.0, 37.6, -45]]
      .forEach(([k, dx, y, r]) => b.pcb('led' + k, X(dx), y, r));
    b.pcb('u1', X(0), 25.0, 0);
    b.pcb('sw1', X(-11.1), 17.4, 0);
    b.pcb('sw2', X(11.1), 17.4, 0);
    b.pcb('r1', X(-10.4), 22.0, 0);
    b.pcb('r2', X(10.4), 22.0, 180);
    b.pcb('d1', X(-9.4), 27.4, 25);
    b.pcb('d2', X(9.4), 27.4, 155);
    ['r8', 'r3', 'r5', 'r7', 'r6', 'r4'].forEach((id, i) => b.pcb(id, X(-6.35 + i * 2.54), 35.0, 90));
    // передний край разъёма (y = +3.65 от начала посадочного места) выступает за край платы на 0.3 мм;
    // центр площадок — на 1.5 мм выше начала координат
    b.pcb('usb1', X(0), 48.5 + 0.3 - 3.65 - 1.4975, 0);
    b.pcb('h1', X(-12.5), 4.0, 0);
    b.pcb('h2', X(12.5), 4.0, 0);
    P.pcb.shape = { type: 'heart', w: 48.6, h: 48.5, x: 0, y: 0 };
    P.pcb.color = 'purple';
    P.pcb.texts = [
      { text: 'GND', x: X(-12.5), y: 7.0, size: 1 },
      { text: '+5V', x: X(12.5), y: 7.0, size: 1 },
      { text: 'Heart V1.1', x: X(19.5), y: 20, size: 1.2, rot: -90, bottom: true },
      { text: 'by_Madamin', x: X(-17.1), y: 20.6, size: 1, rot: -90 },
    ];
    return P;
  }

  // плата-сердце для 3D-вида: схема и расстановка — как у Example_Heart, открывается на вкладке «3D»
  function heart3d() {
    const P = heart();
    P.name = 'Example_Heart_3D';
    return P;
  }

  AK.EXAMPLES = [
    { id: 'led', name: 'Светодиод с резистором', desc: 'Батарея, резистор и светодиод', build: ledBasic },
    { id: 'blinker', name: 'Мигалка на NE555', desc: 'Таймер в режиме генератора, мигает светодиод', build: blinker },
    { id: 'switch', name: 'Транзисторный ключ', desc: 'Кнопка включает светодиод через NPN-транзистор', build: transistorSwitch },
    { id: 'night', name: 'Сумеречный выключатель', desc: 'Фоторезистор и транзистор: в темноте светодиод горит', build: nightLight },
    { id: 'reg', name: 'Стабилизатор 5 В', desc: '7805 делает +5 В из 9 В батареи', build: regulator },
    { id: 'nano', name: 'Arduino Nano: Blink', desc: 'Светодиод на выводе D13', build: nanoBlink },
    { id: 'heart', name: 'Example_Heart', desc: 'Плата-сердце: ATtiny85, 11 светодиодов WS2812B, кнопки, USB-C. С печатной платой в форме сердца', build: heart },
    { id: 'heart3d', name: 'Example_Heart_3D', desc: 'Та же плата-сердце, открывается сразу в 3D: фиолетовая плата с деталями, как на фото. В EasyEDA — с 3D-моделями деталей', build: heart3d, tab: '3d' },
  ];

  // подпись автора на каждой плате-примере: под деталями, в поле контура
  function sign(P) {
    const pcb = AK.PCB.ensure(P);
    if (!pcb.texts.some(t => t.text === 'by_Madamin')) {
      const b = AK.PCB.partsBBox(P);
      pcb.texts.push({ text: 'by_Madamin', x: Math.round((b.x1 + b.x2) / 2 * 10) / 10, y: Math.round((b.y2 + 1.1) * 10) / 10, size: 1 });
    }
    return P;
  }
  AK.EXAMPLES.forEach(ex => { const f = ex.build; ex.build = () => sign(f()); });

  AK.demoProject = blinker;
})();
