// Build a baseline JPEG of any size without a full-frame pixel buffer.
// Each 8×8 block is a flat colour (DC only), so a 12000×9000 file stays a
// few megabytes instead of the ~400MB a decoded bitmap would be. The loader
// must still treat the frame as that large.
import { idctDcSample } from '../src/jpeg-scale.js';

const STD = {
  dcYCounts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  dcYValues: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  acYCounts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  acYValues: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12,
    0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
    0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
    0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79,
    0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
    0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4,
    0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
    0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
  dcCCounts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  dcCValues: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  acCCounts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  acCValues: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21,
    0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
    0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34,
    0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38,
    0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
    0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
    0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
    0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
    0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2,
    0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9,
    0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
};

function huffmanCodes(counts, values) {
  const codes = [];
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) {
      codes[values[k]] = { code, len };
      k += 1;
      code += 1;
    }
    code <<= 1;
  }
  return codes;
}

const DC_Y = huffmanCodes(STD.dcYCounts, STD.dcYValues);
const AC_Y = huffmanCodes(STD.acYCounts, STD.acYValues);
const DC_C = huffmanCodes(STD.dcCCounts, STD.dcCValues);
const AC_C = huffmanCodes(STD.acCCounts, STD.acCValues);

function dcBits(value) {
  if (value === 0) return { s: 0, bits: 0 };
  let s = 0;
  let t = Math.abs(value);
  while (t > 0) { s += 1; t >>= 1; }
  const bits = value < 0 ? value + (1 << s) - 1 : value;
  return { s, bits };
}

const DC_FOR_LEVEL = Array.from({ length: 256 }, (_, level) => {
  let best = 0;
  let bestErr = 1e9;
  for (let q = -1024; q <= 1024; q++) {
    const err = Math.abs(idctDcSample(q, 1) - level);
    if (err < bestErr) {
      bestErr = err;
      best = q;
      if (err === 0) break;
    }
  }
  return best;
});

function rgbToYCbCr(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return {
    y: Math.max(0, Math.min(255, Math.round(y))),
    cb: Math.max(0, Math.min(255, Math.round(cb))),
    cr: Math.max(0, Math.min(255, Math.round(cr))),
  };
}

function push16(out, n) {
  out.push((n >> 8) & 255, n & 255);
}

function dht(out, cls, id, counts, values) {
  out.push(0xFF, 0xC4);
  const len = 2 + 1 + 16 + values.length;
  push16(out, len);
  out.push((cls << 4) | id);
  for (const c of counts) out.push(c);
  for (const v of values) out.push(v);
}

function dqt(out, id) {
  out.push(0xFF, 0xDB);
  push16(out, 67);
  out.push(id);
  for (let i = 0; i < 64; i++) out.push(1);
}

function appPad(out, bytes) {
  let left = bytes;
  while (left > 0) {
    const n = Math.min(left, 65000);
    out.push(0xFF, 0xE0);
    push16(out, n + 2);
    for (let i = 0; i < n; i++) out.push(0);
    left -= n;
  }
}

function exifOrientation(out, orientation) {
  if (!(orientation >= 2 && orientation <= 8)) return;
  const entry = [
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
    orientation & 255, 0x00, 0x00, 0x00,
  ];
  // Little-endian TIFF: orientation SHORT at the value offset of the entry.
  const payload = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    ...entry,
    0x00, 0x00, 0x00, 0x00,
  ];
  out.push(0xFF, 0xE1);
  push16(out, payload.length + 2);
  for (const b of payload) out.push(b);
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.n = 0;
  }
  write(code, len) {
    this.acc = (this.acc << len) | (code & ((1 << len) - 1));
    this.n += len;
    while (this.n >= 8) {
      this.n -= 8;
      const b = (this.acc >> this.n) & 255;
      this.bytes.push(b);
      if (b === 0xFF) this.bytes.push(0x00);
    }
  }
  finish() {
    if (this.n > 0) {
      const pad = (1 << (8 - this.n)) - 1;
      const b = ((this.acc << (8 - this.n)) | pad) & 255;
      this.bytes.push(b);
      if (b === 0xFF) this.bytes.push(0x00);
    }
    return this.bytes;
  }
}

function writeDc(bits, value, table, eob) {
  const { s, bits: mag } = dcBits(value);
  const h = table[s];
  bits.write(h.code, h.len);
  if (s) bits.write(mag, s);
  bits.write(eob.code, eob.len);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {{orientation?: number, padBytes?: number, sample?: (x:number, y:number) => {r:number,g:number,b:number}}} [opts]
 * `sample` is called with the block's top-left pixel.
 */
export function makeBlockJpeg(width, height, opts = {}) {
  const sample = opts.sample || ((x, y) => ({
    r: Math.round(255 * x / Math.max(1, width - 1)),
    g: Math.round(180 * y / Math.max(1, height - 1)),
    b: 70,
  }));
  const out = [0xFF, 0xD8];
  appPad(out, opts.padBytes || 0);
  exifOrientation(out, opts.orientation || 1);
  dqt(out, 0);
  dqt(out, 1);
  out.push(0xFF, 0xC0);
  push16(out, 17);
  out.push(8);
  push16(out, height);
  push16(out, width);
  out.push(3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1);
  dht(out, 0, 0, STD.dcYCounts, STD.dcYValues);
  dht(out, 1, 0, STD.acYCounts, STD.acYValues);
  dht(out, 0, 1, STD.dcCCounts, STD.dcCValues);
  dht(out, 1, 1, STD.acCCounts, STD.acCValues);
  out.push(0xFF, 0xDA);
  push16(out, 12);
  out.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0);

  const bits = new BitWriter();
  const eobY = AC_Y[0x00];
  const eobC = AC_C[0x00];
  let predY = 0; let predCb = 0; let predCr = 0;
  const blocksX = Math.ceil(width / 8);
  const blocksY = Math.ceil(height / 8);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const rgb = sample(Math.min(width - 1, bx * 8), Math.min(height - 1, by * 8));
      const ycc = rgbToYCbCr(rgb.r, rgb.g, rgb.b);
      const y = DC_FOR_LEVEL[ycc.y];
      const cb = DC_FOR_LEVEL[ycc.cb];
      const cr = DC_FOR_LEVEL[ycc.cr];
      writeDc(bits, y - predY, DC_Y, eobY);
      writeDc(bits, cb - predCb, DC_C, eobC);
      writeDc(bits, cr - predCr, DC_C, eobC);
      predY = y; predCb = cb; predCr = cr;
    }
  }
  for (const b of bits.finish()) out.push(b);
  out.push(0xFF, 0xD9);
  return Uint8Array.from(out);
}
