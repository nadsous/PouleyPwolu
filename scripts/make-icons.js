// Génère les icônes (PNG + ICO + SVG) à partir du sprite de la poule.
// Aucune dépendance : encodeur PNG minimal avec zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const S = require('../src/shared/sprites.js');

const OUT = path.join(__dirname, '..', 'build');
fs.mkdirSync(OUT, { recursive: true });

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Icône : carré noir arrondi + poule centrée, rendu sur-échantillonné (4x4).
function renderIcon(size) {
  const rows = S.POULE;
  const grid = rows.length;
  const pad = 3;
  const total = grid + pad * 2;
  const radius = 0.22 * size;
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  const bg = hexToRgb('#0E0E10');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          // carré arrondi
          const dx = Math.max(radius - px, 0, px - (size - radius));
          const dy = Math.max(radius - py, 0, py - (size - radius));
          if (dx * dx + dy * dy > radius * radius) continue;
          let col = bg;
          const gx = Math.floor((px / size) * total) - pad;
          const gy = Math.floor((py / size) * total) - pad;
          if (gy >= 0 && gy < grid && gx >= 0 && gx < rows[gy].length) {
            const ch = rows[gy][gx];
            if (ch !== '.' && S.PALETTE[ch]) col = hexToRgb(S.PALETTE[ch]);
          }
          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      if (a > 0) {
        const cov = a / 255;
        rgba[i] = Math.round(r / cov);
        rgba[i + 1] = Math.round(g / cov);
        rgba[i + 2] = Math.round(b / cov);
      }
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, rgba);
}

function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

// Image latérale de l'installateur NSIS (164 x 314, BMP 24 bits) :
// nuit étoilée, lune, herbe pixel et la poule au centre.
function encodeBmp(w, h, pixel) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + rowSize * h);
  buf.write('BM', 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = 54 + (h - 1 - y) * rowSize + x * 3;
      buf[o] = b; buf[o + 1] = g; buf[o + 2] = r;
    }
  }
  return buf;
}

function sidebarPixel(w, h) {
  const rows = S.POULE;
  const scale = 5;
  const ox = Math.floor((w - 24 * scale) / 2);
  const oy = h - 70 - 22 * scale;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars = new Set();
  for (let i = 0; i < 60; i++) stars.add(Math.floor(rnd() * w) + ',' + Math.floor(rnd() * (h - 120)));
  return (x, y) => {
    const gx = Math.floor((x - ox) / scale);
    const gy = Math.floor((y - oy) / scale);
    if (gy >= 0 && gy < rows.length && gx >= 0 && gx < 24) {
      const ch = rows[gy][gx];
      if (ch !== '.' && S.PALETTE[ch]) return hexToRgb(S.PALETTE[ch]);
    }
    if (y >= h - 62) return y < h - 56 ? (Math.floor(x / 6) % 2 ? [59, 178, 115] : [35, 134, 79]) : [31, 110, 67];
    if (Math.hypot(x - (w - 40), y - 40) < 18) return [255, 236, 140];
    if (stars.has(x + ',' + y)) return [255, 255, 255];
    const t = y / h;
    return [Math.round(7 + 30 * t), Math.round(9 + 18 * t), Math.round(18 + 40 * t)];
  };
}
fs.writeFileSync(path.join(OUT, 'installerSidebar.bmp'), encodeBmp(164, 314, sidebarPixel(164, 314)));
fs.writeFileSync(path.join(OUT, 'uninstallerSidebar.bmp'), encodeBmp(164, 314, sidebarPixel(164, 314)));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => ({ size, data: renderIcon(size) }));
fs.writeFileSync(path.join(OUT, 'icon.ico'), encodeIco(pngs));
fs.writeFileSync(path.join(OUT, 'icon.png'), renderIcon(512));
fs.writeFileSync(
  path.join(OUT, 'icon.svg'),
  S.toSvg(S.POULE, { background: '#0E0E10', pad: 3 }),
);
console.log('Icônes générées dans build/');
