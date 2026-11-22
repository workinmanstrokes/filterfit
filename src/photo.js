// Load a photo without ever decoding it at full resolution.
//
// A Samsung S25 Ultra shot is 50–200MP. Decoding that straight into an
// Image or a Bitmap is hundreds of megabytes, and the first canvas draw of
// it runs on the main thread — the UI freezes on both the PWA and the
// Android app. This module reads the header (no pixels), then decodes
// straight to a small bitmap: createImageBitmap's resize options subsample
// during decode, on a worker when the browser allows it.
//
// Interactive work (analysis, previews, the editor) uses WORKING_LONG_EDGE.
// Export may go back to the original file, but never past EXPORT_LONG_EDGE,
// and never by decoding the full frame first.

export const WORKING_LONG_EDGE = 2048;
export const EXPORT_LONG_EDGE = 4096;
// Passed to the Capacitor Camera plugin. The Android decoder subsamples to
// this box (scripts/patch-capacitor-camera.mjs); a normal 12MP photo is
// unchanged, and a 200MP frame never becomes an 800MB bitmap.
export const NATIVE_PHOTO_MAX_EDGE = 4096;
export const LOAD_TIMEOUT_MS = 20000;

const UNKNOWN_SIZE_BYTE_LIMIT = 18 * 1024 * 1024;

export class PhotoLoadError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PhotoLoadError';
    this.code = code;
  }
}

export function releaseImage(image) {
  if (image && typeof image.close === 'function') {
    try { image.close(); } catch { /* already closed */ }
  }
}

// Longest side becomes maxEdge. Aspect ratio is preserved. Already-small
// images are returned unchanged (never upscaled).
export function fitLongEdge(width, height, maxEdge) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  if (!(w > 0 && h > 0)) return { width: 1, height: 1 };
  const long = Math.max(w, h);
  if (!(maxEdge > 0) || long <= maxEdge) return { width: w, height: h };
  if (w >= h) return { width: maxEdge, height: Math.max(1, Math.round(h * (maxEdge / w))) };
  return { width: Math.max(1, Math.round(w * (maxEdge / h))), height: maxEdge };
}

// EXIF orientations 5–8 swap the axes. 1–4 do not.
export function orientedSize(width, height, orientation) {
  const o = orientation | 0;
  if (o >= 5 && o <= 8) return { width: height, height: width };
  return { width, height };
}

export function cameraGetPhotoOptions(source, resultType) {
  return {
    quality: 90,
    allowEditing: false,
    resultType,
    source,
    width: NATIVE_PHOTO_MAX_EDGE,
    height: NATIVE_PHOTO_MAX_EDGE,
    correctOrientation: true,
  };
}

function timeoutMs(explicit) {
  if (Number.isFinite(explicit)) return explicit;
  const override = globalThis.__FILTERFIT_LOAD_TIMEOUT_MS;
  if (Number.isFinite(override)) return override;
  return LOAD_TIMEOUT_MS;
}

function withTimeout(promise, ms, code) {
  if (!(ms > 0)) return Promise.reject(new PhotoLoadError(code));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new PhotoLoadError(code));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function yieldToMain() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function validDim(width, height) {
  return width > 0 && height > 0 && width <= 100000 && height <= 100000;
}

function u16(buf, offset, le) {
  if (offset + 1 >= buf.length) return 0;
  return le ? (buf[offset] | (buf[offset + 1] << 8)) : ((buf[offset] << 8) | buf[offset + 1]);
}

function u32(buf, offset, le) {
  if (offset + 3 >= buf.length) return 0;
  if (le) {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
  }
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

// IFD0 orientation only. A thumbnail IFD later in the same EXIF block can
// carry a different value and must not win.
function readExifOrientation(segment) {
  if (segment.length < 16) return 0;
  if (segment[0] !== 0x45 || segment[1] !== 0x78 || segment[2] !== 0x69 || segment[3] !== 0x66 || segment[4] !== 0 || segment[5] !== 0) {
    return 0;
  }
  const tiff = 6;
  const le = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49;
  const be = segment[tiff] === 0x4D && segment[tiff + 1] === 0x4D;
  if (!le && !be) return 0;
  if (u16(segment, tiff + 2, le) !== 42) return 0;
  const ifd = tiff + u32(segment, tiff + 4, le);
  if (ifd + 2 > segment.length) return 0;
  const count = u16(segment, ifd, le);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > segment.length) break;
    if (u16(segment, entry, le) !== 0x0112) continue;
    const type = u16(segment, entry + 2, le);
    const value = u16(segment, entry + 8, le);
    if ((type === 3 || type === 4) && value >= 1 && value <= 8) return value;
  }
  return 0;
}

async function readJpegMeta(blob) {
  const limit = Math.min(blob.size, 32 * 1024 * 1024);
  let buf = new Uint8Array(0);
  const ensure = async (end) => {
    if (buf.length >= end || buf.length >= limit) return;
    const want = Math.min(limit, Math.max(end, Math.min(limit, Math.max(buf.length * 2, 65536))));
    if (want <= buf.length) return;
    const extra = new Uint8Array(await blob.slice(buf.length, want).arrayBuffer());
    if (!extra.length) return;
    const merged = new Uint8Array(buf.length + extra.length);
    merged.set(buf, 0);
    merged.set(extra, buf.length);
    buf = merged;
  };

  await ensure(4);
  if (buf.length < 2 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let offset = 2;
  let orientation = 1;
  let sawExif = false;

  while (offset + 4 <= limit) {
    await ensure(offset + 4);
    if (offset >= buf.length || buf[offset] !== 0xFF) return null;
    let markerAt = offset + 1;
    while (markerAt < buf.length && buf[markerAt] === 0xFF) markerAt += 1;
    await ensure(markerAt + 1);
    if (markerAt >= buf.length) return null;
    const marker = buf[markerAt];
    offset = markerAt + 1;
    // Standalone markers (SOI, EOI, RSTn) have no length.
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue;

    await ensure(offset + 2);
    if (offset + 2 > buf.length) return null;
    const segLen = (buf[offset] << 8) | buf[offset + 1];
    if (segLen < 2) return null;
    const content = offset + 2;
    const contentLen = segLen - 2;
    await ensure(content + contentLen);
    if (content + contentLen > buf.length) return null;

    // SOF0/1/2/3 — baseline, extended, progressive. Height then width.
    if (marker >= 0xC0 && marker <= 0xC3) {
      if (contentLen < 5) return null;
      const height = (buf[content + 1] << 8) | buf[content + 2];
      const width = (buf[content + 3] << 8) | buf[content + 4];
      if (!validDim(width, height)) return null;
      return { width, height, orientation };
    }
    if (marker === 0xE1 && !sawExif) {
      const parsed = readExifOrientation(buf.subarray(content, content + contentLen));
      if (parsed) {
        orientation = parsed;
        sawExif = true;
      }
    }
    if (marker === 0xDA) break; // start of scan — dimensions would already have appeared
    offset = content + contentLen;
  }
  return null;
}

function readPngMeta(head) {
  if (head.length < 24) return null;
  if (head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4E || head[3] !== 0x47) return null;
  const width = u32(head, 16, false);
  const height = u32(head, 20, false);
  if (!validDim(width, height)) return null;
  return { width, height, orientation: 1 };
}

function readGifMeta(head) {
  if (head.length < 10) return null;
  const sig = String.fromCharCode(head[0], head[1], head[2], head[3], head[4], head[5]);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  const width = head[6] | (head[7] << 8);
  const height = head[8] | (head[9] << 8);
  if (!validDim(width, height)) return null;
  return { width, height, orientation: 1 };
}

function readWebpMeta(head) {
  if (head.length < 30) return null;
  if (String.fromCharCode(head[0], head[1], head[2], head[3]) !== 'RIFF') return null;
  if (String.fromCharCode(head[8], head[9], head[10], head[11]) !== 'WEBP') return null;
  const fourcc = String.fromCharCode(head[12], head[13], head[14], head[15]);
  if (fourcc === 'VP8X') {
    const width = 1 + (head[24] | (head[25] << 8) | (head[26] << 16));
    const height = 1 + (head[27] | (head[28] << 8) | (head[29] << 16));
    if (!validDim(width, height)) return null;
    return { width, height, orientation: 1 };
  }
  if (fourcc === 'VP8 ') {
    const width = (head[26] | (head[27] << 8)) & 0x3fff;
    const height = (head[28] | (head[29] << 8)) & 0x3fff;
    if (!validDim(width, height)) return null;
    return { width, height, orientation: 1 };
  }
  if (fourcc === 'VP8L' && head[20] === 0x2f) {
    const bits = (head[21] | (head[22] << 8) | (head[23] << 16) | (head[24] << 24)) >>> 0;
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    if (!validDim(width, height)) return null;
    return { width, height, orientation: 1 };
  }
  return null;
}

function findAscii(buf, text) {
  const n = text.length;
  for (let i = 0; i + n <= buf.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (buf[i + j] !== text.charCodeAt(j)) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

async function readHeifMeta(blob) {
  const limit = Math.min(blob.size, 2 * 1024 * 1024);
  const buf = new Uint8Array(await blob.slice(0, limit).arrayBuffer());
  const ispe = findAscii(buf, 'ispe');
  if (ispe < 0 || ispe + 16 > buf.length) return null;
  const width = u32(buf, ispe + 8, false);
  const height = u32(buf, ispe + 12, false);
  if (!validDim(width, height)) return null;
  let orientation = 1;
  const irot = findAscii(buf, 'irot');
  if (irot >= 0 && irot + 4 < buf.length) {
    const angle = buf[irot + 4] & 0x3;
    // irot is counter-clockwise. 1 and 3 swap the axes.
    if (angle === 1) orientation = 8;
    else if (angle === 2) orientation = 3;
    else if (angle === 3) orientation = 6;
  }
  return { width, height, orientation };
}

function looksHeif(head) {
  if (head.length < 12) return false;
  if (String.fromCharCode(head[4], head[5], head[6], head[7]) !== 'ftyp') return false;
  const major = String.fromCharCode(head[8], head[9], head[10], head[11]);
  return major === 'heic' || major === 'heix' || major === 'hevc' || major === 'hevx'
    || major === 'mif1' || major === 'msf1' || major === 'avif';
}

// Dimensions and EXIF orientation from the file header. Never decodes pixels.
export async function readImageMeta(blob) {
  if (!blob || typeof blob.slice !== 'function' || !(blob.size > 0)) return null;
  const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 64)).arrayBuffer());
  if (head.length >= 3 && head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return readJpegMeta(blob);
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50) return readPngMeta(head.length >= 24 ? head : new Uint8Array(await blob.slice(0, 32).arrayBuffer()));
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return readGifMeta(head);
  if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) {
    const webp = head.length >= 30 ? head : new Uint8Array(await blob.slice(0, Math.min(blob.size, 40)).arrayBuffer());
    return readWebpMeta(webp);
  }
  if (looksHeif(head)) return readHeifMeta(blob);
  return null;
}

async function metaFromImageDecoder(blob, budgetMs) {
  if (typeof ImageDecoder !== 'function') return null;
  let decoder;
  try {
    decoder = new ImageDecoder({ data: blob, type: blob.type || undefined });
    await withTimeout(decoder.tracks.ready, Math.min(budgetMs, 4000), 'timeout');
    const track = decoder.tracks.selectedTrack;
    const width = track && (track.displayWidth || track.codedWidth);
    const height = track && (track.displayHeight || track.codedHeight);
    if (!validDim(width, height)) return null;
    // displayWidth/displayHeight are already oriented.
    return { width, height };
  } catch (err) {
    if (err instanceof PhotoLoadError) throw err;
    return null;
  } finally {
    try { decoder && decoder.close(); } catch { /* ignore */ }
  }
}

const WORKER_SRC = `
self.onmessage = async (event) => {
  const { blob, options } = event.data || {};
  try {
    const bitmap = await createImageBitmap(blob, options);
    self.postMessage({ ok: true, bitmap }, [bitmap]);
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err || 'decode') });
  }
};
`;

function decodeInWorker(blob, options, budgetMs) {
  return new Promise((resolve, reject) => {
    let worker;
    let url;
    try {
      url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch (err) {
      if (url) try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      reject(err);
      return;
    }
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch { /* ignore */ }
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new PhotoLoadError('timeout')), budgetMs);
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.ok && data.bitmap) finish(resolve, data.bitmap);
      else finish(reject, new Error(data.error || 'decode'));
    };
    worker.onerror = (event) => finish(reject, new Error(event.message || 'worker'));
    try {
      worker.postMessage({ blob, options });
    } catch (err) {
      finish(reject, err);
    }
  });
}

function bitmapOptions(orientedWidth, orientedHeight, maxEdge) {
  const target = fitLongEdge(orientedWidth, orientedHeight, maxEdge);
  const needsResize = target.width < orientedWidth || target.height < orientedHeight;
  // Resize is applied to the oriented image (createImageBitmap imageOrientation
  // 'from-image'). Both axes are set so the picture is not stretched.
  const options = { imageOrientation: 'from-image' };
  if (needsResize) {
    options.resizeWidth = target.width;
    options.resizeHeight = target.height;
    options.resizeQuality = 'high';
  }
  return { options, target, needsResize };
}

async function decodeResized(blob, options, budgetMs, hooks) {
  if (!(budgetMs > 0)) throw new PhotoLoadError('timeout');
  const factory = hooks.createImageBitmap ?? globalThis.createImageBitmap;
  const workerAllowed = hooks.useWorker !== false
    && globalThis.__FILTERFIT_DISABLE_WORKER__ !== true
    && typeof Worker === 'function'
    && typeof Blob === 'function';
  if (workerAllowed) {
    try {
      return await decodeInWorker(blob, options, budgetMs);
    } catch (err) {
      if (err instanceof PhotoLoadError && err.code === 'timeout') throw err;
    }
  }
  if (typeof factory !== 'function') throw new PhotoLoadError('decode');
  return withTimeout(Promise.resolve().then(() => factory(blob, options)), budgetMs, 'timeout');
}

function loadImageElement(url, budgetMs) {
  return withTimeout(new Promise((resolve, reject) => {
    if (typeof Image !== 'function') {
      reject(new PhotoLoadError('decode'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new PhotoLoadError('decode'));
    img.src = url;
  }), budgetMs, 'timeout');
}

// Last resort for modest photos when createImageBitmap cannot resize.
// Refuses frames above EXPORT_LONG_EDGE — drawing those would freeze the page.
async function loadViaImageElement(file, maxEdge, budgetMs) {
  if (!(budgetMs > 0)) throw new PhotoLoadError('timeout');
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new PhotoLoadError('decode');
  let url;
  try {
    url = URL.createObjectURL(file);
  } catch {
    throw new PhotoLoadError('decode');
  }
  try {
    const img = await loadImageElement(url, budgetMs);
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    if (!(sw > 0 && sh > 0)) throw new PhotoLoadError('decode');
    if (Math.max(sw, sh) > EXPORT_LONG_EDGE) throw new PhotoLoadError('tooBig');
    const target = fitLongEdge(sw, sh, maxEdge);
    const downscaled = target.width !== sw || target.height !== sh;
    if (!downscaled) {
      return { image: img, width: sw, height: sh, sourceWidth: sw, sourceHeight: sh, downscaled: false };
    }
    await yieldToMain();
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') throw new PhotoLoadError('decode');
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoLoadError('decode');
    ctx.drawImage(img, 0, 0, target.width, target.height);
    try { img.src = ''; } catch { /* ignore */ }
    return {
      image: canvas,
      width: target.width,
      height: target.height,
      sourceWidth: sw,
      sourceHeight: sh,
      downscaled: true,
    };
  } finally {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}

/**
 * Decode `file` to a drawable whose longest side is at most `maxEdge`.
 * Returns { image, width, height, sourceWidth, sourceHeight, downscaled }.
 * `sourceWidth`/`sourceHeight` are the oriented original dimensions.
 * Throws PhotoLoadError with code timeout | decode | empty | tooBig.
 */
export async function loadPhoto(file, hooks = {}) {
  const maxEdge = hooks.maxEdge || WORKING_LONG_EDGE;
  const budgetAt = Date.now() + timeoutMs(hooks.timeoutMs);
  const budget = () => budgetAt - Date.now();

  if (!file) throw new PhotoLoadError('empty');

  // Headless DOM stub used by tests/smoke-main.mjs — not a real Blob.
  if (typeof file.slice !== 'function') {
    return loadViaImageElement(file, maxEdge, budget());
  }
  if (!(file.size > 0)) throw new PhotoLoadError('empty');

  let oriented = null;
  const meta = await readImageMeta(file);
  if (meta && validDim(meta.width, meta.height)) {
    oriented = orientedSize(meta.width, meta.height, meta.orientation || 1);
  } else {
    const decoded = await metaFromImageDecoder(file, budget());
    if (decoded) oriented = { width: decoded.width, height: decoded.height };
  }

  const factory = hooks.createImageBitmap ?? globalThis.createImageBitmap;
  if (typeof factory === 'function' && oriented) {
    const { options, target, needsResize } = bitmapOptions(oriented.width, oriented.height, maxEdge);
    try {
      const bitmap = await decodeResized(file, options, budget(), hooks);
      const width = bitmap.width || target.width;
      const height = bitmap.height || target.height;
      if (needsResize && Math.max(width, height) > maxEdge * 1.25) {
        releaseImage(bitmap);
        throw new PhotoLoadError('tooBig');
      }
      return {
        image: bitmap,
        width,
        height,
        sourceWidth: oriented.width,
        sourceHeight: oriented.height,
        downscaled: needsResize,
      };
    } catch (err) {
      if (err instanceof PhotoLoadError && (err.code === 'timeout' || err.code === 'tooBig')) throw err;
      // Resize decode failed. A full-frame fallback is only safe for modest photos.
    }
  }

  if (oriented && Math.max(oriented.width, oriented.height) > EXPORT_LONG_EDGE) {
    throw new PhotoLoadError('tooBig');
  }
  if (!oriented && file.size > UNKNOWN_SIZE_BYTE_LIMIT) throw new PhotoLoadError('tooBig');
  return loadViaImageElement(file, maxEdge, budget());
}
