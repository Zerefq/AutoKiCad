// Общие вспомогательные функции
window.AK = window.AK || {};

AK.util = (function () {
  let counter = 0;

  function uid(prefix) {
    counter++;
    return prefix + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch (e) { /* небезопасный контекст */ }
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  const MULT = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, R: 1, r: 1 };

  // "4.7k" -> 4700, "4k7" -> 4700, "100n" -> 1e-7, "220" -> 220
  function parseValue(s) {
    if (s == null) return NaN;
    s = String(s).trim().replace(/\s+/g, '').replace(/(Ω|ohm|Ом|F|Ф|H|Гн|V|В)$/i, '');
    const m = s.match(/^(\d*\.?\d+)([pnuµμmkKMGRr]?)(\d*)$/);
    if (!m) return NaN;
    let num = m[3] ? parseFloat(m[1] + '.' + m[3]) : parseFloat(m[1]);
    if (m[2]) num *= MULT[m[2]];
    return num;
  }

  function fmt(n, digits) {
    const p = Math.pow(10, digits == null ? 4 : digits);
    const v = Math.round(n * p) / p;
    return (Object.is(v, -0) ? 0 : v).toString();
  }

  function download(name, text, mime) {
    const blob = text instanceof Blob ? text : new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function rotPt(x, y, deg) {
    const r = ((deg % 360) + 360) % 360;
    if (r === 0) return [x, y];
    if (r === 90) return [-y, x];
    if (r === 180) return [-x, -y];
    if (r === 270) return [y, -x];
    const a = r * Math.PI / 180;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  }

  // Минимальный ZIP без сжатия (store). files: [[путь, текст], ...] -> Uint8Array
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(([name, text]) => {
      const nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
      parts.push(new Uint8Array(local.buffer), nameB, data);
      central.push(new Uint8Array(cen.buffer), nameB);
      offset += 30 + nameB.length + data.length;
    });
    const cenSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    all.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }

  // SVG-текст → PNG (Blob); scale — во сколько раз крупнее размеров SVG
  function svgToPng(svgText, scale) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * (scale || 1));
        cv.height = Math.round(img.naturalHeight * (scale || 1));
        const g = cv.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(b => (b ? resolve(b) : reject(new Error('не удалось создать картинку'))), 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG не загрузился')); };
      img.src = url;
    });
  }

  return { uid, uuid, parseValue, fmt, download, esc, rotPt, zip, svgToPng };
})();
