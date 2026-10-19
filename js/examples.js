// Примеры проектов (меню «Примеры»). Все собраны на макетной плате:
// компоненты ставятся ножкой в отверстие по имени (a1…j30, TP/TN/BP/BN — шины), провода — перемычки.
window.AK = window.AK || {};

(function () {
  const RED = '#e53935', BLK = '#212121', BLU = '#1e88e5', GRN = '#43a047', YEL = '#fdd835', ORG = '#fb8c00';

  // конструктор проекта: плата BB1 в (300, 250)
  function builder(name) {
    const bb = { id: 'bb', type: 'breadboard', ref: 'BB1', value: '', x: 300, y: 250, rot: 0, props: {} };
    const P = { version: 1, name, components: [bb], wires: [] };
    let wn = 0;
    return {
      P,
      // компонент вывод pin (по умолчанию первый) — в отверстие hole
      put(id, type, ref, value, hole, rot, props, pinId) {
        const d = AK.LIB[type];
        const p = d.visual.pins[pinId || Object.keys(d.visual.pins)[0]];
        const [hx, hy] = AK.pinWorld(bb, hole);
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
      // перемычка между отверстиями платы
      jump(a, b, color, points, net) { this.wire('bb', a, 'bb', b, color, points, net); },
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

  AK.EXAMPLES = [
    { id: 'led', name: 'Светодиод с резистором', desc: 'Батарея, резистор и светодиод', build: ledBasic },
    { id: 'blinker', name: 'Мигалка на NE555', desc: 'Таймер в режиме генератора, мигает светодиод', build: blinker },
    { id: 'switch', name: 'Транзисторный ключ', desc: 'Кнопка включает светодиод через NPN-транзистор', build: transistorSwitch },
    { id: 'night', name: 'Сумеречный выключатель', desc: 'Фоторезистор и транзистор: в темноте светодиод горит', build: nightLight },
    { id: 'reg', name: 'Стабилизатор 5 В', desc: '7805 делает +5 В из 9 В батареи', build: regulator },
    { id: 'nano', name: 'Arduino Nano: Blink', desc: 'Светодиод на выводе D13', build: nanoBlink },
  ];

  AK.demoProject = blinker;
})();
