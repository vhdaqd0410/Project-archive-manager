// 生成程序化图标 PNG 文件（供 electron-builder 使用）
const fs = require('fs');
const path = require('path');

const SIZE = 256;
const C = {
  bgTop:    [59, 130, 246],
  bgBot:    [37, 99, 235],
  folder:   [255, 255, 255],
  foldDark: [29, 78, 216],
  check:    [34, 197, 94],
};

const r = SIZE * 0.20;
const tabW = SIZE * 0.28;
const tabH = SIZE * 0.15;
const bodyTop = tabH * 0.85;
const foldPad = SIZE * 0.08;

function lerp(a, b, t) { return a + (b - a) * t; }
function mixCol(c1, c2, t) { return [lerp(c1[0],c2[0],t), lerp(c1[1],c2[1],t), lerp(c1[2],c2[2],t)]; }

function edgeDist(x, y, l, t, w, h, cr) {
  const cx = x - (l + w/2), cy = y - (t + h/2);
  const ax = Math.abs(cx) - (w/2 - cr), ay = Math.abs(cy) - (h/2 - cr);
  if (ax <= 0 && ay <= 0) return Math.min(w/2 - cr - Math.abs(cx), h/2 - cr - Math.abs(cy));
  if (ax > 0 && ay > 0) return cr - Math.sqrt(ax*ax + ay*ay);
  if (ax > 0) return cr - ax;
  return cr - ay;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx*abx + aby*aby;
  let t = ((px-ax)*abx + (py-ay)*aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + t*abx), dy = py - (ay + t*aby);
  return Math.sqrt(dx*dx + dy*dy);
}

// RGBA buffer
const buf = Buffer.alloc(SIZE * SIZE * 4);

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const i = (py * SIZE + px) * 4;
    const x = px + 0.5, y = py + 0.5;

    // 背景圆角矩形
    const bgDist = edgeDist(x, y, 0, 0, SIZE, SIZE, r);
    const bgAA = Math.min(1, Math.max(0, bgDist + 0.5));
    if (bgAA <= 0) { buf[i+3] = 0; continue; }

    const gradT = py / SIZE;
    const bgCol = mixCol(C.bgTop, C.bgBot, gradT);
    buf[i] = bgCol[0]; buf[i+1] = bgCol[1]; buf[i+2] = bgCol[2];
    buf[i+3] = Math.round(Math.min(255, bgAA * 255));

    // 文件夹标签
    const tabLeft = SIZE * 0.20;
    const tabDist = edgeDist(x, y, tabLeft, 0, tabW + r*0.3, tabH, r*0.4);
    if (tabDist > -0.3) {
      const tAA = Math.min(1, Math.max(0, tabDist + 0.5));
      const tCol = mixCol(C.foldDark, [29,78,216], gradT);
      const alpha = Math.round(tAA * 255);
      if (alpha > 0) {
        buf[i] = Math.round(lerp(buf[i], tCol[0], alpha/255));
        buf[i+1] = Math.round(lerp(buf[i+1], tCol[1], alpha/255));
        buf[i+2] = Math.round(lerp(buf[i+2], tCol[2], alpha/255));
      }
    }

    // 文件夹主体
    const fL = foldPad, fT = bodyTop + foldPad * 0.5;
    const fW = SIZE - foldPad * 2, fH = SIZE - fT - foldPad * 1.2;
    const fDist = edgeDist(x, y, fL, fT, fW, fH, r * 0.6);
    if (fDist > -0.4) {
      const fAA = Math.min(1, Math.max(0, fDist + 0.5));
      const alpha = Math.round(fAA * 255);
      if (alpha > 0) {
        buf[i] = Math.round(lerp(buf[i], C.folder[0], alpha/255));
        buf[i+1] = Math.round(lerp(buf[i+1], C.folder[1], alpha/255));
        buf[i+2] = Math.round(lerp(buf[i+2], C.folder[2], alpha/255));
      }
    }

    // 对勾
    const cx = SIZE * 0.52, cy = SIZE * 0.58;
    const cw = SIZE * 0.20, ch = SIZE * 0.12;
    const checkThick = Math.max(1, SIZE * 0.06);
    const x1 = cx - cw, y1 = cy;
    const x2 = cx, y2 = cy + ch;
    const x3 = cx + cw * 1.25, y3 = cy - ch * 0.6;
    const d1 = distToSeg(x, y, x1, y1, x2, y2);
    const d2 = distToSeg(x, y, x2, y2, x3, y3);
    const minD = Math.min(d1, d2);
    const cAA = Math.min(1, Math.max(0, (checkThick - minD) * 0.5 + 0.3));
    if (cAA > 0) {
      const alpha = Math.round(cAA * 220);
      buf[i] = Math.round(lerp(buf[i], C.check[0], alpha/255));
      buf[i+1] = Math.round(lerp(buf[i+1], C.check[1], alpha/255));
      buf[i+2] = Math.round(lerp(buf[i+2], C.check[2], alpha/255));
    }
  }
}

// 写 PNG（最小实现：IHDR + IDAT + IEND）
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(12 + len);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 'ascii');
  data.copy(buf, 8);
  buf.writeUInt32BE(crc32(buf.slice(4, 8 + len)), 8 + len);
  return buf;
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// IDAT: raw RGBA with filter byte 0 per row, then zlib deflate
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const srcOff = y * SIZE * 4;
  const dstOff = y * (1 + SIZE * 4);
  raw[dstOff] = 0; // filter: none
  buf.copy(raw, dstOff + 1, srcOff, srcOff + SIZE * 4);
}

const zlib = require('zlib');
const compressed = zlib.deflateSync(raw);

// 写入文件
const chunks = [
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
];

const outPath = path.join(__dirname, 'public', 'app-icon.png');
const out = Buffer.concat(chunks);
fs.writeFileSync(outPath, out);
console.log('Icon generated: ' + outPath + ' (' + out.length + ' bytes)');
