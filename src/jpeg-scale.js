// Shrink-on-load JPEG decode.
//
// Chrome's createImageBitmap({resizeWidth, resizeHeight}) still decodes the
// full frame first (Skia scales afterwards). A Samsung S25 Ultra shot is
// ~200MP / ~800MB of RGBA, and allocating that — even inside a worker —
// stalls the renderer until Android reports "Chrome isn't responding".
//
// This decoder never materialises the full frame. Baseline and extended
// sequential JPEGs are Huffman-decoded one MCU at a time and inverse-DCT'd
// straight into a plane whose long edge fits `maxEdge` (libjpeg's 1/2, 1/4
// and 1/8 scales). Progressive files keep only the coefficients required for
// that scale, and a 200MP progressive file keeps the DC of each block only.
// The result is upright RGBA, capped at maxEdge.

const ZIGZAG = new Uint8Array([
  0,
  1, 8,
  16, 9, 2,
  3, 10, 17, 24,
  32, 25, 18, 11, 4,
  5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6,
  7, 14, 21, 28, 35, 42, 49, 56,
  57, 50, 43, 36, 29, 22, 15,
  23, 30, 37, 44, 51, 58,
  59, 52, 45, 38, 31,
  39, 46, 53, 60,
  61, 54, 47,
  55, 62,
  63,
]);

const DCT_COS1 = 4017;
const DCT_SIN1 = 799;
const DCT_COS3 = 3406;
const DCT_SIN3 = 2276;
const DCT_COS6 = 1567;
const DCT_SIN6 = 3784;
const DCT_SQRT2 = 5793;
const DCT_SQRT1D2 = 2896;

const PIXEL_CAP = 9 * 1024 * 1024;

export function chooseJpegScale(width, height, maxEdge) {
  const edge = Math.max(1, maxEdge | 0);
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  // A full 8×8 IDCT of a 200MP frame is millions of blocks. DC-only (1/8)
  // is the block average and stays inside a 1600px working image.
  if (blocks > 400000) return 8;
  const decodeCap = Math.max(edge, Math.round(edge * 1.25));
  let chosen = 8;
  for (const denom of [1, 2, 4, 8]) {
    const outW = Math.ceil(width / denom);
    const outH = Math.ceil(height / denom);
    if (outW * outH > PIXEL_CAP && denom !== 8) continue;
    if (Math.max(outW, outH) <= decodeCap) return denom;
    chosen = denom;
  }
  return chosen;
}

// 16-bit prefix lookup. JPEG Huffman codes are at most 16 bits, so one peek
// resolves a symbol. The old bit-at-a-time tree walked a JS object per bit
// and could not finish a 20MB Samsung scan without stalling the phone.
function buildFastHuffman(codeLengths, values) {
  const syms = new Uint8Array(65536);
  const lens = new Uint8Array(65536);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const count = codeLengths[len - 1] || 0;
    for (let i = 0; i < count; i++) {
      const symbol = values[k++];
      const shift = 16 - len;
      const base = code << shift;
      const n = 1 << shift;
      for (let j = 0; j < n; j++) {
        syms[base + j] = symbol;
        lens[base + j] = len;
      }
      code += 1;
    }
    code <<= 1;
  }
  return { syms, lens };
}

// Integer IDCT matching the Loeffler/poppler path used by jpeg-js, so a
// full-resolution decode lines up with a known-good decoder.
const idctScratch = new Int32Array(64);

function idct8(zz, quant, out) {
  const p = idctScratch;
  for (let i = 0; i < 64; i++) p[i] = zz[i] * quant[i];

  for (let i = 0; i < 8; i++) {
    const row = i * 8;
    if (p[1 + row] === 0 && p[2 + row] === 0 && p[3 + row] === 0
      && p[4 + row] === 0 && p[5 + row] === 0 && p[6 + row] === 0 && p[7 + row] === 0) {
      const t = (DCT_SQRT2 * p[row] + 512) >> 10;
      p[row] = t; p[1 + row] = t; p[2 + row] = t; p[3 + row] = t;
      p[4 + row] = t; p[5 + row] = t; p[6 + row] = t; p[7 + row] = t;
      continue;
    }
    let v0 = (DCT_SQRT2 * p[row] + 128) >> 8;
    let v1 = (DCT_SQRT2 * p[4 + row] + 128) >> 8;
    let v2 = p[2 + row];
    let v3 = p[6 + row];
    let v4 = (DCT_SQRT1D2 * (p[1 + row] - p[7 + row]) + 128) >> 8;
    let v7 = (DCT_SQRT1D2 * (p[1 + row] + p[7 + row]) + 128) >> 8;
    let v5 = p[3 + row] << 4;
    let v6 = p[5 + row] << 4;
    let t = (v0 - v1 + 1) >> 1;
    v0 = (v0 + v1 + 1) >> 1;
    v1 = t;
    t = (v2 * DCT_SIN6 + v3 * DCT_COS6 + 128) >> 8;
    v2 = (v2 * DCT_COS6 - v3 * DCT_SIN6 + 128) >> 8;
    v3 = t;
    t = (v4 - v6 + 1) >> 1;
    v4 = (v4 + v6 + 1) >> 1;
    v6 = t;
    t = (v7 + v5 + 1) >> 1;
    v5 = (v7 - v5 + 1) >> 1;
    v7 = t;
    t = (v0 - v3 + 1) >> 1;
    v0 = (v0 + v3 + 1) >> 1;
    v3 = t;
    t = (v1 - v2 + 1) >> 1;
    v1 = (v1 + v2 + 1) >> 1;
    v2 = t;
    t = (v4 * DCT_SIN3 + v7 * DCT_COS3 + 2048) >> 12;
    v4 = (v4 * DCT_COS3 - v7 * DCT_SIN3 + 2048) >> 12;
    v7 = t;
    t = (v5 * DCT_SIN1 + v6 * DCT_COS1 + 2048) >> 12;
    v5 = (v5 * DCT_COS1 - v6 * DCT_SIN1 + 2048) >> 12;
    v6 = t;
    p[row] = v0 + v7;
    p[7 + row] = v0 - v7;
    p[1 + row] = v1 + v6;
    p[6 + row] = v1 - v6;
    p[2 + row] = v2 + v5;
    p[5 + row] = v2 - v5;
    p[3 + row] = v3 + v4;
    p[4 + row] = v3 - v4;
  }

  for (let col = 0; col < 8; col++) {
    if (p[8 + col] === 0 && p[16 + col] === 0 && p[24 + col] === 0
      && p[32 + col] === 0 && p[40 + col] === 0 && p[48 + col] === 0 && p[56 + col] === 0) {
      const t = (DCT_SQRT2 * p[col] + 8192) >> 14;
      p[col] = t; p[8 + col] = t; p[16 + col] = t; p[24 + col] = t;
      p[32 + col] = t; p[40 + col] = t; p[48 + col] = t; p[56 + col] = t;
      continue;
    }
    let v0 = (DCT_SQRT2 * p[col] + 2048) >> 12;
    let v1 = (DCT_SQRT2 * p[32 + col] + 2048) >> 12;
    let v2 = p[16 + col];
    let v3 = p[48 + col];
    let v4 = (DCT_SQRT1D2 * (p[8 + col] - p[56 + col]) + 2048) >> 12;
    let v7 = (DCT_SQRT1D2 * (p[8 + col] + p[56 + col]) + 2048) >> 12;
    let v5 = p[24 + col];
    let v6 = p[40 + col];
    let t = (v0 - v1 + 1) >> 1;
    v0 = (v0 + v1 + 1) >> 1;
    v1 = t;
    t = (v2 * DCT_SIN6 + v3 * DCT_COS6 + 2048) >> 12;
    v2 = (v2 * DCT_COS6 - v3 * DCT_SIN6 + 2048) >> 12;
    v3 = t;
    t = (v4 - v6 + 1) >> 1;
    v4 = (v4 + v6 + 1) >> 1;
    v6 = t;
    t = (v7 + v5 + 1) >> 1;
    v5 = (v7 - v5 + 1) >> 1;
    v7 = t;
    t = (v0 - v3 + 1) >> 1;
    v0 = (v0 + v3 + 1) >> 1;
    v3 = t;
    t = (v1 - v2 + 1) >> 1;
    v1 = (v1 + v2 + 1) >> 1;
    v2 = t;
    t = (v4 * DCT_SIN3 + v7 * DCT_COS3 + 2048) >> 12;
    v4 = (v4 * DCT_COS3 - v7 * DCT_SIN3 + 2048) >> 12;
    v7 = t;
    t = (v5 * DCT_SIN1 + v6 * DCT_COS1 + 2048) >> 12;
    v5 = (v5 * DCT_COS1 - v6 * DCT_SIN1 + 2048) >> 12;
    v6 = t;
    p[col] = v0 + v7;
    p[56 + col] = v0 - v7;
    p[8 + col] = v1 + v6;
    p[48 + col] = v1 - v6;
    p[16 + col] = v2 + v5;
    p[40 + col] = v2 - v5;
    p[24 + col] = v3 + v4;
    p[32 + col] = v3 - v4;
  }

  for (let i = 0; i < 64; i++) {
    const sample = 128 + ((p[i] + 8) >> 4);
    out[i] = sample < 0 ? 0 : sample > 255 ? 255 : sample;
  }
}

// 1/8 scale keeps the DC of each block: one pixel, the block average.
export function idctDcSample(dc, q0) {
  const row = (DCT_SQRT2 * (dc * q0) + 512) >> 10;
  const col = (DCT_SQRT2 * row + 8192) >> 14;
  const sample = 128 + ((col + 8) >> 4);
  if (sample < 0) return 0;
  if (sample > 255) return 255;
  return sample;
}

function clamp8(v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}

function writeBlock(comp, blockRow, blockCol, zz, denom, block) {
  if (denom === 8) {
    if (blockCol < comp.usedW && blockRow < comp.usedH) {
      comp.plane[blockRow * comp.stride + blockCol] = idctDcSample(zz[0], comp.quant[0]);
    }
    return;
  }
  idct8(zz, comp.quant, block);
  const pix = 8 / denom;
  const area = denom * denom;
  const x0 = blockCol * pix;
  const y0 = blockRow * pix;
  for (let py = 0; py < pix; py++) {
    const yy = y0 + py;
    if (yy >= comp.usedH) break;
    const rowBase = yy * comp.stride;
    for (let px = 0; px < pix; px++) {
      const xx = x0 + px;
      if (xx >= comp.usedW) break;
      let sum = 0;
      const sy = py * denom;
      const sx = px * denom;
      for (let iy = 0; iy < denom; iy++) {
        const r = (sy + iy) * 8 + sx;
        for (let ix = 0; ix < denom; ix++) sum += block[r + ix];
      }
      comp.plane[rowBase + xx] = (sum + (area >> 1)) / area | 0;
    }
  }
}

function skipEntropy(data, offset) {
  const n = data.length;
  while (offset < n - 1) {
    if (data[offset] !== 0xFF) { offset += 1; continue; }
    let k = offset;
    while (k < n && data[k] === 0xFF) k += 1;
    if (k >= n) return offset;
    const marker = data[k];
    if (marker === 0x00) { offset = k + 1; continue; }
    if (marker >= 0xD0 && marker <= 0xD7) { offset = k + 1; continue; }
    return k - 1;
  }
  return offset;
}

function orientDimensions(width, height, orientation) {
  const o = orientation | 0;
  if (o >= 5 && o <= 8) return { width: height, height: width };
  return { width, height };
}

function fitEdge(width, height, maxEdge) {
  const long = Math.max(width, height);
  if (!(maxEdge > 0) || long <= maxEdge) return { width, height };
  if (width >= height) return { width: maxEdge, height: Math.max(1, Math.round(height * (maxEdge / width))) };
  return { width: Math.max(1, Math.round(width * (maxEdge / height))), height: maxEdge };
}

export function orientRgba(rgba, width, height, orientation) {
  const o = orientation | 0;
  if (o < 2 || o > 8) return { rgba, width, height };
  const swap = o >= 5;
  const dw = swap ? height : width;
  const dh = swap ? width : height;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dx = x;
      let dy = y;
      if (o === 2) dx = width - 1 - x;
      else if (o === 3) { dx = width - 1 - x; dy = height - 1 - y; }
      else if (o === 4) dy = height - 1 - y;
      else if (o === 5) { dx = y; dy = x; }
      else if (o === 6) { dx = height - 1 - y; dy = x; }
      else if (o === 7) { dx = height - 1 - y; dy = width - 1 - x; }
      else if (o === 8) { dx = y; dy = width - 1 - x; }
      const si = (y * width + x) * 4;
      const di = (dy * dw + dx) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = 255;
    }
  }
  return { rgba: out, width: dw, height: dh };
}

function boxShrink(src, sw, sh, dw, dh) {
  const dst = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = (y * sh / dh) | 0;
    let y1 = ((y + 1) * sh / dh) | 0;
    if (y1 <= y0) y1 = y0 + 1;
    for (let x = 0; x < dw; x++) {
      const x0 = (x * sw / dw) | 0;
      let x1 = ((x + 1) * sw / dw) | 0;
      if (x1 <= x0) x1 = x0 + 1;
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1 && yy < sh; yy++) {
        const row = yy * sw;
        for (let xx = x0; xx < x1 && xx < sw; xx++) {
          const i = (row + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; n += 1;
        }
      }
      const o = (y * dw + x) * 4;
      dst[o] = r / n;
      dst[o + 1] = g / n;
      dst[o + 2] = b / n;
      dst[o + 3] = 255;
    }
  }
  return dst;
}

function ycbcr(y, cb, cr, out, o) {
  const r = y - 179.456 + 1.402 * cr;
  const g = y + 135.459 - 0.344 * cb - 0.714 * cr;
  const b = y - 226.816 + 1.772 * cb;
  out[o] = clamp8(r);
  out[o + 1] = clamp8(g);
  out[o + 2] = clamp8(b);
  out[o + 3] = 255;
}

function composeRgba(components, width, height, denom, convert) {
  const outW = Math.ceil(width / denom);
  const outH = Math.ceil(height / denom);
  const rgba = new Uint8ClampedArray(outW * outH * 4);
  const n = components.length;
  const yComp = components[0];
  const cbComp = n > 1 ? components[1] : null;
  const crComp = n > 2 ? components[2] : null;
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(yComp.usedH - 1, y);
    const yRow = sy * yComp.stride;
    let cbRow = 0; let crRow = 0; let cy = 0;
    if (cbComp) {
      cy = Math.min(cbComp.usedH - 1, (y * cbComp.usedH / outH) | 0);
      cbRow = cy * cbComp.stride;
      crRow = cy * crComp.stride;
    }
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(yComp.usedW - 1, x);
      const o = (y * outW + x) * 4;
      const Y = yComp.plane[yRow + sx];
      if (n === 1 || !cbComp) {
        rgba[o] = Y; rgba[o + 1] = Y; rgba[o + 2] = Y; rgba[o + 3] = 255;
        continue;
      }
      const cx = Math.min(cbComp.usedW - 1, (x * cbComp.usedW / outW) | 0);
      const cb = cbComp.plane[cbRow + cx];
      const cr = crComp.plane[crRow + cx];
      // Adobe transform 0 (and ASCII RGB component ids) are already RGB.
      if (!convert) {
        rgba[o] = Y; rgba[o + 1] = cb; rgba[o + 2] = cr; rgba[o + 3] = 255;
        continue;
      }
      ycbcr(Y, cb, cr, rgba, o);
    }
  }
  return { rgba, width: outW, height: outH };
}

function timeoutError() {
  const err = new Error('timeout');
  err.code = 'timeout';
  return err;
}

export async function decodeJpegScaled(input, opts = {}) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxEdge = opts.maxEdge || 1600;
  const orientation = opts.orientation || 1;
  const deadline = opts.deadline || 0;
  const yieldLoop = opts.yieldToEventLoop !== false;
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) throw new Error('not a jpeg');

  const quantTables = [];
  const dcTables = [];
  const acTables = [];
  let components = null;
  let width = 0;
  let height = 0;
  let progressive = false;
  let resetInterval = 0;
  let adobeTransform = null;
  let denom = 8;
  let dcOnly = false;
  const block = new Uint8Array(64);

  const ensureQuant = (comp) => {
    if (!comp.quant) {
      comp.quant = quantTables[comp.quantId];
      if (!comp.quant) throw new Error('missing quant table');
    }
  };

  const paintStored = () => {
    const zz = new Int32Array(64);
    for (const comp of components) {
      ensureQuant(comp);
      const count = comp.blocksPerLine * comp.blocksPerColumn;
      for (let b = 0; b < count; b++) {
        zz.fill(0);
        const blockRow = (b / comp.blocksPerLine) | 0;
        const blockCol = b % comp.blocksPerLine;
        if (comp.coeffs) {
          const base = b * 64;
          for (let k = 0; k < 64; k++) zz[k] = comp.coeffs[base + k];
        } else if (comp.dc) {
          zz[0] = comp.dc[b];
        }
        writeBlock(comp, blockRow, blockCol, zz, denom, block);
      }
    }
  };

  async function decodeScan(offset, scanComps, spectralStart, spectralEnd, successivePrev, successive) {
    if (dcOnly && spectralStart !== 0) return skipEntropy(data, offset);

    let bitsData = 0;
    let bitsCount = 0;
    let off = offset;
    // Stream offset of each byte currently sitting in the bit window, so a
    // restart marker that was prefetched can be pushed back without undoing
    // a stuffed 0xFF00.
    const byteOrigins = [];
    const pullByte = () => {
      if (off >= data.length || bitsCount > 24) return false;
      byteOrigins.push(off);
      let b = data[off++];
      if (b === 0xFF) {
        if (off >= data.length) {
          off = byteOrigins.pop();
          return false;
        }
        const next = data[off++];
        if (next !== 0) {
          off = byteOrigins.pop();
          return false;
        }
      }
      bitsData = ((bitsData << 8) | b) >>> 0;
      bitsCount += 8;
      return true;
    };
    const trimOrigins = () => {
      const held = bitsCount > 0 ? Math.ceil(bitsCount / 8) : 0;
      if (byteOrigins.length > held) byteOrigins.splice(0, byteOrigins.length - held);
    };
    const dropBits = (n) => {
      bitsCount -= n;
      if (bitsCount <= 0) {
        bitsCount = 0;
        bitsData = 0;
        byteOrigins.length = 0;
        return;
      }
      bitsData &= (0xFFFFFFFF >>> (32 - bitsCount));
      trimOrigins();
    };
    const ensureBits = (n) => {
      while (bitsCount < n && pullByte()) { /* fill */ }
    };
    const readBits = (length) => {
      if (length <= 0) return 0;
      ensureBits(length);
      if (bitsCount < length) throw new Error('truncated jpeg');
      const value = (bitsData >>> (bitsCount - length)) & ((1 << length) - 1);
      dropBits(length);
      return value;
    };
    const readBit = () => readBits(1);
    const receive = (length) => readBits(length);
    const receiveAndExtend = (length) => {
      const n = readBits(length);
      if (n >= (1 << (length - 1))) return n;
      return n + (-1 << length) + 1;
    };
    const decodeHuffman = (table) => {
      if (!table || !table.lens) throw new Error('missing huffman table');
      ensureBits(16);
      const peek = bitsCount >= 16
        ? (bitsData >>> (bitsCount - 16)) & 0xFFFF
        : (bitsData << (16 - bitsCount)) & 0xFFFF;
      const len = table.lens[peek];
      if (!len || len > bitsCount) throw new Error('bad huffman sequence');
      dropBits(len);
      return table.syms[peek];
    };
    const discardPadding = () => {
      const extra = Math.floor(bitsCount / 8);
      if (extra > 0 && byteOrigins.length >= extra) {
        off = byteOrigins[byteOrigins.length - extra];
      }
      bitsCount = 0;
      bitsData = 0;
      byteOrigins.length = 0;
    };

    const zz = new Int32Array(64);
    const mcusPerLine = components.mcusPerLine;
    const progressiveScan = progressive;
    let eobrun = 0;
    let successiveACState = 0;
    let successiveACNextValue = 0;

    const decodeBaseline = (comp) => {
      zz.fill(0);
      const t = decodeHuffman(comp.dcTable);
      const diff = t === 0 ? 0 : receiveAndExtend(t);
      zz[0] = (comp.pred += diff);
      let k = 1;
      while (k < 64) {
        const rs = decodeHuffman(comp.acTable);
        const s = rs & 15;
        const r = rs >> 4;
        if (s === 0) {
          if (r < 15) break;
          k += 16;
          continue;
        }
        k += r;
        zz[ZIGZAG[k]] = receiveAndExtend(s);
        k += 1;
      }
    };

    const storeDc = (comp, blockRow, blockCol, value) => {
      const index = blockRow * comp.blocksPerLine + blockCol;
      if (comp.dc) comp.dc[index] = value;
      if (comp.coeffs) comp.coeffs[index * 64] = value;
    };
    const loadZz = (comp, blockRow, blockCol) => {
      zz.fill(0);
      if (!comp.coeffs) {
        zz[0] = comp.dc[blockRow * comp.blocksPerLine + blockCol] || 0;
        return;
      }
      const base = (blockRow * comp.blocksPerLine + blockCol) * 64;
      for (let k = 0; k < 64; k++) zz[k] = comp.coeffs[base + k];
    };
    const saveZz = (comp, blockRow, blockCol) => {
      if (!comp.coeffs) {
        storeDc(comp, blockRow, blockCol, zz[0]);
        return;
      }
      const base = (blockRow * comp.blocksPerLine + blockCol) * 64;
      for (let k = 0; k < 64; k++) comp.coeffs[base + k] = zz[k];
    };

    const decodeDCFirst = (comp) => {
      const t = decodeHuffman(comp.dcTable);
      const diff = t === 0 ? 0 : receiveAndExtend(t) << successive;
      zz[0] = (comp.pred += diff);
    };
    const decodeDCSuccessive = () => {
      zz[0] |= readBit() << successive;
    };
    const decodeACFirst = (comp) => {
      if (eobrun > 0) { eobrun -= 1; return; }
      let k = spectralStart;
      while (k <= spectralEnd) {
        const rs = decodeHuffman(comp.acTable);
        const s = rs & 15;
        const r = rs >> 4;
        if (s === 0) {
          if (r < 15) {
            eobrun = receive(r) + (1 << r) - 1;
            break;
          }
          k += 16;
          continue;
        }
        k += r;
        zz[ZIGZAG[k]] = receiveAndExtend(s) * (1 << successive);
        k += 1;
      }
    };
    const decodeACSuccessive = (comp) => {
      let k = spectralStart;
      let r = 0;
      while (k <= spectralEnd) {
        const z = ZIGZAG[k];
        const direction = zz[z] < 0 ? -1 : 1;
        if (successiveACState === 0) {
          const rs = decodeHuffman(comp.acTable);
          const s = rs & 15;
          r = rs >> 4;
          if (s === 0) {
            if (r < 15) {
              eobrun = receive(r) + (1 << r);
              successiveACState = 4;
            } else {
              r = 16;
              successiveACState = 1;
            }
          } else {
            if (s !== 1) throw new Error('bad progressive AC');
            successiveACNextValue = receiveAndExtend(s);
            successiveACState = r ? 2 : 3;
          }
          continue;
        } else if (successiveACState === 1 || successiveACState === 2) {
          if (zz[z]) zz[z] += (readBit() << successive) * direction;
          else {
            r -= 1;
            if (r === 0) successiveACState = successiveACState === 2 ? 3 : 0;
          }
        } else if (successiveACState === 3) {
          if (zz[z]) zz[z] += (readBit() << successive) * direction;
          else {
            zz[z] = successiveACNextValue << successive;
            successiveACState = 0;
          }
        } else if (zz[z]) {
          zz[z] += (readBit() << successive) * direction;
        }
        k += 1;
      }
      if (successiveACState === 4) {
        eobrun -= 1;
        if (eobrun === 0) successiveACState = 0;
      }
    };

    const finishBlock = (comp, blockRow, blockCol) => {
      if (!progressiveScan) {
        ensureQuant(comp);
        writeBlock(comp, blockRow, blockCol, zz, denom, block);
        return;
      }
      if (spectralStart === 0) storeDc(comp, blockRow, blockCol, zz[0]);
      saveZz(comp, blockRow, blockCol);
    };

    const mcuExpected = scanComps.length === 1
      ? scanComps[0].blocksPerLine * scanComps[0].blocksPerColumn
      : mcusPerLine * components.mcusPerColumn;
    const restart = resetInterval || mcuExpected;
    let mcu = 0;
    let sinceYield = 0;
    let lastYield = performance.now();

    const decodeOne = (comp, blockRow, blockCol) => {
      if (progressiveScan) {
        loadZz(comp, blockRow, blockCol);
        if (spectralStart === 0) {
          if (successivePrev === 0) decodeDCFirst(comp);
          else decodeDCSuccessive();
        } else if (successivePrev === 0) decodeACFirst(comp);
        else decodeACSuccessive(comp);
        finishBlock(comp, blockRow, blockCol);
      } else {
        decodeBaseline(comp);
        finishBlock(comp, blockRow, blockCol);
      }
    };

    while (mcu < mcuExpected) {
      for (const comp of scanComps) comp.pred = 0;
      eobrun = 0;
      const run = Math.min(restart, mcuExpected - mcu);
      if (scanComps.length === 1) {
        const comp = scanComps[0];
        for (let n = 0; n < run; n++) {
          const blockRow = (mcu / comp.blocksPerLine) | 0;
          const blockCol = mcu % comp.blocksPerLine;
          decodeOne(comp, blockRow, blockCol);
          mcu += 1;
          sinceYield += 1;
        }
      } else {
        for (let n = 0; n < run; n++) {
          const mcuRow = (mcu / mcusPerLine) | 0;
          const mcuCol = mcu % mcusPerLine;
          for (const comp of scanComps) {
            for (let j = 0; j < comp.v; j++) {
              for (let k = 0; k < comp.h; k++) {
                decodeOne(comp, mcuRow * comp.v + j, mcuCol * comp.h + k);
              }
            }
          }
          mcu += 1;
          sinceYield += 1;
          if (mcu === mcuExpected) break;
        }
      }
      if (sinceYield >= 32) {
        sinceYield = 0;
        if (deadline && Date.now() > deadline) throw timeoutError();
        if (yieldLoop && performance.now() - lastYield > 12) {
          await new Promise((resolve) => { setTimeout(resolve, 0); });
          lastYield = performance.now();
          if (deadline && Date.now() > deadline) throw timeoutError();
        }
      }
      if (mcu >= mcuExpected) {
        discardPadding();
        while (off < data.length - 1) {
          if (data[off] === 0xFF && data[off + 1] !== 0x00) break;
          off += 1;
        }
        break;
      }
      discardPadding();
      if (off + 1 >= data.length) break;
      const marker = (data[off] << 8) | data[off + 1];
      if (marker >= 0xFFD0 && marker <= 0xFFD7) off += 2;
      else break;
    }
    return off;
  }

  let offset = 2;
  while (offset + 1 < data.length) {
    if (data[offset] !== 0xFF) throw new Error('jpeg marker expected');
    let m = offset + 1;
    while (m < data.length && data[m] === 0xFF) m += 1;
    if (m >= data.length) break;
    const marker = data[m];
    offset = m + 1;
    if (marker === 0xD9) break;
    if (marker >= 0xD0 && marker <= 0xD7) continue;
    if (offset + 2 > data.length) throw new Error('truncated jpeg');
    const segLen = (data[offset] << 8) | data[offset + 1];
    if (segLen < 2 || offset + segLen > data.length) throw new Error('bad segment');

    if (marker === 0xDA) {
      if (!components) throw new Error('scan before frame');
      const count = data[offset + 2];
      let p = offset + 3;
      const scanComps = [];
      for (let i = 0; i < count; i++) {
        const id = data[p++];
        const spec = data[p++];
        const comp = components.find((c) => c.id === id);
        if (!comp) throw new Error('unknown component');
        comp.dcTable = dcTables[spec >> 4];
        comp.acTable = acTables[spec & 15];
        scanComps.push(comp);
      }
      const spectralStart = data[p++];
      const spectralEnd = data[p++];
      const successive = data[p++];
      offset += segLen;
      offset = await decodeScan(
        offset,
        scanComps,
        spectralStart,
        spectralEnd,
        successive >> 4,
        successive & 15,
      );
      continue;
    }

    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      if (components) throw new Error('multiple frames');
      progressive = marker === 0xC2;
      const base = offset + 2;
      const precision = data[base];
      height = (data[base + 1] << 8) | data[base + 2];
      width = (data[base + 3] << 8) | data[base + 4];
      if (precision !== 8 || !(width > 0 && height > 0)) throw new Error('unsupported jpeg frame');
      const count = data[base + 5];
      if (count < 1 || count > 4) throw new Error('unsupported component count');
      let maxH = 1; let maxV = 1;
      const list = [];
      let p = base + 6;
      for (let i = 0; i < count; i++) {
        const id = data[p++];
        const hv = data[p++];
        const quantId = data[p++];
        const h = hv >> 4;
        const v = hv & 15;
        if (!(h >= 1 && h <= 4 && v >= 1 && v <= 4)) throw new Error('bad sampling');
        if (h > maxH) maxH = h;
        if (v > maxV) maxV = v;
        list.push({ id, h, v, quantId, quant: null, pred: 0 });
      }
      const mcusPerLine = Math.ceil(width / (8 * maxH));
      const mcusPerColumn = Math.ceil(height / (8 * maxV));
      let totalBlocks = 0;
      for (const comp of list) {
        comp.blocksPerLine = mcusPerLine * comp.h;
        comp.blocksPerColumn = mcusPerColumn * comp.v;
        totalBlocks += comp.blocksPerLine * comp.blocksPerColumn;
      }
      denom = chooseJpegScale(width, height, maxEdge);
      dcOnly = progressive && totalBlocks * 64 * 2 > 40 * 1024 * 1024;
      if (dcOnly) denom = 8;
      const pix = 8 / denom;
      for (const comp of list) {
        const fullX = Math.ceil(width * comp.h / maxH);
        const fullY = Math.ceil(height * comp.v / maxV);
        comp.usedW = Math.max(1, Math.ceil(fullX / denom));
        comp.usedH = Math.max(1, Math.ceil(fullY / denom));
        comp.stride = comp.blocksPerLine * pix;
        comp.plane = new Uint8Array(comp.stride * comp.blocksPerColumn * pix);
        const blocks = comp.blocksPerLine * comp.blocksPerColumn;
        if (progressive && !dcOnly) comp.coeffs = new Int16Array(blocks * 64);
        else if (progressive && dcOnly) comp.dc = new Int16Array(blocks);
      }
      list.mcusPerLine = mcusPerLine;
      list.mcusPerColumn = mcusPerColumn;
      list.maxH = maxH;
      list.maxV = maxV;
      components = list;
    } else if (marker === 0xDB) {
      let p = offset + 2;
      const end = offset + segLen;
      while (p < end) {
        const spec = data[p++];
        const table = new Int32Array(64);
        if ((spec >> 4) === 0) {
          for (let j = 0; j < 64; j++) table[ZIGZAG[j]] = data[p++];
        } else if ((spec >> 4) === 1) {
          for (let j = 0; j < 64; j++) {
            table[ZIGZAG[j]] = (data[p] << 8) | data[p + 1];
            p += 2;
          }
        } else throw new Error('bad quant table');
        quantTables[spec & 15] = table;
      }
    } else if (marker === 0xC4) {
      let p = offset + 2;
      const end = offset + segLen;
      while (p < end) {
        const spec = data[p++];
        const lens = new Uint8Array(16);
        let sum = 0;
        for (let i = 0; i < 16; i++) sum += (lens[i] = data[p++]);
        const vals = new Uint8Array(sum);
        for (let i = 0; i < sum; i++) vals[i] = data[p++];
        const table = buildFastHuffman(lens, vals);
        if ((spec >> 4) === 0) dcTables[spec & 15] = table;
        else acTables[spec & 15] = table;
      }
    } else if (marker === 0xDD) {
      resetInterval = (data[offset + 2] << 8) | data[offset + 3];
    } else if (marker === 0xEE && segLen >= 14) {
      const b = offset + 2;
      if (data[b] === 0x41 && data[b + 1] === 0x64 && data[b + 2] === 0x6F
        && data[b + 3] === 0x62 && data[b + 4] === 0x65 && data[b + 5] === 0) {
        adobeTransform = data[b + 11];
      }
    } else if ((marker >= 0xC0 && marker <= 0xCF) || marker === 0xC3) {
      throw new Error('unsupported jpeg encoding');
    }

    if (marker !== 0xDA) offset += segLen;
  }

  if (!components) throw new Error('jpeg has no frame');
  if (progressive) paintStored();

  for (const comp of components) ensureQuant(comp);
  const ids = components.map((c) => c.id);
  const rgbIds = ids.length === 3 && ids[0] === 0x52 && ids[1] === 0x47 && ids[2] === 0x42;
  const convert = components.length >= 3 && adobeTransform !== 0 && !rgbIds;
  let composed = composeRgba(components, width, height, denom, convert);
  const orientedSource = orientDimensions(width, height, orientation);
  if ((orientation | 0) >= 2) {
    const turned = orientRgba(composed.rgba, composed.width, composed.height, orientation);
    composed = { rgba: turned.rgba, width: turned.width, height: turned.height };
  }
  const fitted = fitEdge(composed.width, composed.height, maxEdge);
  let rgba = composed.rgba;
  let outW = composed.width;
  let outH = composed.height;
  if (fitted.width !== outW || fitted.height !== outH) {
    rgba = boxShrink(rgba, outW, outH, fitted.width, fitted.height);
    outW = fitted.width;
    outH = fitted.height;
  }
  return {
    rgba,
    width: outW,
    height: outH,
    sourceWidth: orientedSource.width,
    sourceHeight: orientedSource.height,
    downscaled: denom !== 1 || outW !== orientedSource.width || outH !== orientedSource.height,
  };
}
