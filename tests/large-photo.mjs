#!/usr/bin/env node
// Regression: a very large camera photo must not be decoded at full size.
//
// Samsung S25 Ultra shots are 50–200MP. The old capture path did
// `img.src = blobUrl` and then drew that bitmap on the main thread, which
// froze the UI. This drives an 8000×6000 (and a 16320×12240) JPEG through
// the real loader and, in the second half, through src/main.js's file input.
//
// The decoder is mocked so a forgotten resize throws instead of allocating
// hundreds of megabytes. Heap growth is checked as well.
//
// Usage: node tests/large-photo.mjs
import { analyzePixels, recommendFilters } from '../src/analyze.js';
import { renderFiltered, renderFilteredAsync, renderPreview, outputSize } from '../src/filters.js';
import { FILTERS } from '../src/filters.js';
import {
  loadPhoto,
  readImageMeta,
  fitLongEdge,
  orientedSize,
  PhotoLoadError,
  WORKING_LONG_EDGE,
  EXPORT_LONG_EDGE,
  cameraGetPhotoOptions,
} from '../src/photo.js';

const failures = [];
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures.push(name);
}

function u16le(n) {
  return Buffer.from([n & 255, (n >> 8) & 255]);
}
function u32le(n) {
  return Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
}

function exifApp1(orientation) {
  const entry = Buffer.concat([
    u16le(0x0112),
    u16le(3),
    u32le(1),
    u16le(orientation),
    u16le(0),
  ]);
  const ifd = Buffer.concat([u16le(1), entry, u32le(0)]);
  const tiff = Buffer.concat([Buffer.from([0x49, 0x49]), u16le(42), u32le(8), ifd]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const length = payload.length + 2;
  return Buffer.concat([Buffer.from([0xFF, 0xE1, (length >> 8) & 255, length & 255]), payload]);
}

function appPad(bytes) {
  const payload = Buffer.alloc(bytes, 0x11);
  const length = payload.length + 2;
  return Buffer.concat([Buffer.from([0xFF, 0xE0, (length >> 8) & 255, length & 255]), payload]);
}

function sof0(width, height) {
  const body = Buffer.from([
    8,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    3,
    1, 0x11, 0,
    2, 0x11, 0,
    3, 0x11, 0,
  ]);
  const length = body.length + 2;
  return Buffer.concat([Buffer.from([0xFF, 0xC0, (length >> 8) & 255, length & 255]), body]);
}

// A real JPEG container with the requested frame size. Pixel data is not
// needed: the loader must read the header and ask the decoder to resize
// instead of materialising width×height×4 bytes.
function makeJpeg(width, height, { orientation = 1, padBytes = 0 } = {}) {
  const parts = [Buffer.from([0xFF, 0xD8])];
  let left = padBytes;
  while (left > 0) {
    const n = Math.min(left, 60000);
    parts.push(appPad(n));
    left -= n;
  }
  parts.push(exifApp1(orientation));
  parts.push(sof0(width, height));
  parts.push(Buffer.from([0xFF, 0xD9]));
  return Buffer.concat(parts);
}

function jpegFile(width, height, opts) {
  const bytes = makeJpeg(width, height, opts);
  return new File([bytes], `camera-${width}x${height}.jpg`, { type: 'image/jpeg' });
}

function makeMock({ refuseAbove = 4096 * 4096 } = {}) {
  const calls = [];
  let allocated = 0;
  const fn = async (blob, opts = {}) => {
    const meta = await readImageMeta(blob);
    if (!meta) throw new Error('mock decoder: no header');
    const oriented = orientedSize(meta.width, meta.height, meta.orientation || 1);
    const w = opts.resizeWidth || oriented.width;
    const h = opts.resizeHeight || oriented.height;
    const pixels = w * h;
    if (pixels > refuseAbove) {
      const err = new Error(`refusing full-frame decode ${w}x${h}`);
      err.code = 'fullres';
      throw err;
    }
    allocated += pixels * 4;
    calls.push({ ...opts, width: w, height: h, oriented });
    return { width: w, height: h, close() {} };
  };
  return { fn, calls, bytes: () => allocated };
}

const meta8000 = await readImageMeta(jpegFile(8000, 6000));
check('header reads 8000x6000 JPEG', meta8000 && meta8000.width === 8000 && meta8000.height === 6000, JSON.stringify(meta8000));

const metaOrient = await readImageMeta(jpegFile(8000, 6000, { orientation: 6 }));
check('EXIF orientation 6 is kept on the raw frame', metaOrient && metaOrient.orientation === 6 && metaOrient.width === 8000);

const padded = jpegFile(16320, 12240, { padBytes: 180000 });
const tHeader = performance.now();
const meta200 = await readImageMeta(padded);
check(
  '200MP-class header is found past a large EXIF-sized pad',
  meta200 && meta200.width === 16320 && meta200.height === 12240 && performance.now() - tHeader < 2000,
  `${meta200 && meta200.width}x${meta200 && meta200.height} in ${(performance.now() - tHeader).toFixed(0)}ms`,
);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  Buffer.from([0x00, 0x00, 0x00, 0x0D]),
  Buffer.from('IHDR'),
  Buffer.from([0x00, 0x00, 0x1F, 0x40, 0x00, 0x00, 0x17, 0x70]), // 8000 x 6000
  Buffer.alloc(9),
]);
const pngMeta = await readImageMeta(new Blob([png], { type: 'image/png' }));
check('PNG header reads 8000x6000', pngMeta && pngMeta.width === 8000 && pngMeta.height === 6000);

const fitted = fitLongEdge(8000, 6000, WORKING_LONG_EDGE);
check('8000x6000 fits in a 2048 box', fitted.width === 2048 && fitted.height === 1536, `${fitted.width}x${fitted.height}`);
const portrait = fitLongEdge(6000, 8000, WORKING_LONG_EDGE);
check('oriented portrait fits in a 2048 box', portrait.width === 1536 && portrait.height === 2048, `${portrait.width}x${portrait.height}`);
check('a 12MP frame is not upscaled', fitLongEdge(4000, 3000, EXPORT_LONG_EDGE).width === 4000);

const nativeOpts = cameraGetPhotoOptions('CAMERA', 'uri');
check(
  'native camera request caps both axes',
  nativeOpts.width === 4096 && nativeOpts.height === 4096 && nativeOpts.correctOrientation === true,
  JSON.stringify(nativeOpts),
);

const mock = makeMock();
const beforeHeap = process.memoryUsage().heapUsed;
const started = performance.now();
const loaded = await loadPhoto(jpegFile(8000, 6000), { createImageBitmap: mock.fn, useWorker: false });
const elapsed = performance.now() - started;
const heapDelta = process.memoryUsage().heapUsed - beforeHeap;
check('8000x6000 load asks for a resized bitmap', mock.calls.length === 1 && mock.calls[0].resizeWidth === 2048 && mock.calls[0].resizeHeight === 1536, JSON.stringify(mock.calls[0]));
check('resize keeps EXIF orientation from the file', mock.calls[0].imageOrientation === 'from-image');
check('working image long edge is 2048', Math.max(loaded.width, loaded.height) === 2048, `${loaded.width}x${loaded.height}`);
check('source size is remembered for export', loaded.sourceWidth === 8000 && loaded.sourceHeight === 6000 && loaded.downscaled === true);
check('load finishes quickly', elapsed < 3000, `${elapsed.toFixed(0)}ms`);
check('heap did not balloon to a full-frame bitmap', heapDelta < 48 * 1024 * 1024, `${Math.round(heapDelta / 1048576)}MB`);
check('decoder allocation is the small bitmap', mock.bytes() === 2048 * 1536 * 4, `${mock.bytes()} bytes`);

const orientMock = makeMock();
const orientedPhoto = await loadPhoto(jpegFile(8000, 6000, { orientation: 6 }), {
  createImageBitmap: orientMock.fn,
  useWorker: false,
});
check(
  'orientation 6 resizes the displayed portrait, not the raw landscape',
  orientMock.calls[0].resizeWidth === 1536 && orientMock.calls[0].resizeHeight === 2048 && orientedPhoto.height === 2048,
  JSON.stringify(orientMock.calls[0]),
);

const exportMock = makeMock();
const exported = await loadPhoto(jpegFile(4000, 3000), {
  maxEdge: EXPORT_LONG_EDGE,
  createImageBitmap: exportMock.fn,
  useWorker: false,
});
check(
  'a 12MP export is not downscaled',
  exported.width === 4000 && exported.height === 3000 && exported.downscaled === false && !exportMock.calls[0].resizeWidth,
  `${exported.width}x${exported.height}`,
);

const hugeMock = makeMock();
const hugeStarted = performance.now();
const huge = await loadPhoto(jpegFile(16320, 12240), { createImageBitmap: hugeMock.fn, useWorker: false });
check(
  '16320x12240 (200MP class) decodes to 2048 on the long edge',
  Math.max(huge.width, huge.height) === WORKING_LONG_EDGE && hugeMock.calls[0].resizeWidth === 2048,
  `${huge.width}x${huge.height} in ${(performance.now() - hugeStarted).toFixed(0)}ms, mock alloc ${hugeMock.bytes()}B`,
);

const px = new Uint8ClampedArray(huge.width * huge.height * 4);
for (let i = 0; i < px.length; i += 4) {
  px[i] = 210; px[i + 1] = 140; px[i + 2] = 70; px[i + 3] = 255;
}
const analysis = analyzePixels(px);
const recs = recommendFilters(analysis, 3);
check(
  'analysis runs on the downscaled pixel count',
  px.length === huge.width * huge.height * 4 && recs.length === 3 && recs[0].filter && recs[0].score > 0,
  `${recs[0] && recs[0].filter.name} ${recs[0] && recs[0].score}`,
);

let timedOut = false;
const timeoutStarted = performance.now();
try {
  await loadPhoto(jpegFile(8000, 6000), {
    timeoutMs: 40,
    useWorker: false,
    createImageBitmap: () => new Promise(() => {}),
  });
} catch (err) {
  timedOut = err instanceof PhotoLoadError && err.code === 'timeout';
}
check('a stuck decode rejects on timeout', timedOut && performance.now() - timeoutStarted < 1000, `${(performance.now() - timeoutStarted).toFixed(0)}ms`);

let imageCtor = 0;
const OriginalImage = globalThis.Image;
globalThis.Image = class {
  constructor() { imageCtor += 1; this.naturalWidth = 16320; this.naturalHeight = 12240; }
  set src(_) { setTimeout(() => this.onload && this.onload(), 0); }
};
let tooBig = false;
try {
  await loadPhoto(jpegFile(16320, 12240), {
    useWorker: false,
    createImageBitmap: async () => { throw new Error('resize unsupported'); },
  });
} catch (err) {
  tooBig = err instanceof PhotoLoadError && err.code === 'tooBig';
}
check('failed resize of a 200MP frame does not fall back to a full Image decode', tooBig && imageCtor === 0, `ctors=${imageCtor}`);
if (OriginalImage) globalThis.Image = OriginalImage;
else delete globalThis.Image;

function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        filter: '',
        clearRect() {},
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(16) }),
        putImageData() {},
      };
    },
  };
  return canvas;
}
const big = { width: 8000, height: 6000 };
const capped = outputSize(big, {});
check('render refuses a full 8000px canvas', Math.max(capped.width, capped.height) <= 4096, `${capped.width}x${capped.height}`);
const normal = outputSize({ width: 4000, height: 3000 }, {});
check('a 12MP render stays 4000px', normal.width === 4000 && normal.height === 3000);
const previewCanvas = fakeCanvas();
renderPreview(previewCanvas, big, FILTERS[1], 1, {});
check('live preview of an 8000px photo is capped at 1024', Math.max(previewCanvas.width, previewCanvas.height) === 1024, `${previewCanvas.width}x${previewCanvas.height}`);
const exportCanvas = fakeCanvas();
renderFiltered(exportCanvas, big, FILTERS[1], 1, {});
check('sync export of an 8000px photo is capped at 4096', Math.max(exportCanvas.width, exportCanvas.height) === 4096, `${exportCanvas.width}x${exportCanvas.height}`);
const asyncCanvas = fakeCanvas();
const asyncStarted = performance.now();
await renderFilteredAsync(asyncCanvas, { width: 3000, height: 2000 }, FILTERS[1], 0.8, { warmth: 10 });
check(
  'chunked export of a 12MP frame finishes and keeps its size',
  asyncCanvas.width === 3000 && asyncCanvas.height === 2000 && performance.now() - asyncStarted < 3000,
  `${asyncCanvas.width}x${asyncCanvas.height}`,
);

// ---------- Capture path in src/main.js ----------
function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c, force) => {
      if (force === undefined) set.has(c) ? set.delete(c) : set.add(c);
      else if (force) set.add(c);
      else set.delete(c);
    },
    contains: (c) => set.has(c),
  };
}
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: makeClassList(), _listeners: {}, disabled: false, files: [],
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute() {}, removeAttribute() {},
    click() { (this._listeners.click || []).forEach((fn) => fn({ target: this })); },
    dispatch(type, event = {}) { (this._listeners[type] || []).forEach((fn) => fn({ ...event, target: this })); },
    querySelectorAll: () => [],
  };
}
const els = {};
const getEl = (id) => els[id] || (els[id] = makeEl(id));
for (const s of ['screen-home', 'screen-analysing', 'screen-recommendations', 'screen-editor']) {
  els[s] = makeEl(s);
  els[s].classList.add('hidden');
}
els['screen-home'].classList.remove('hidden');
function makeCtx() {
  return {
    filter: '', clearRect() {}, drawImage() {}, putImageData() {},
    getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(128) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  };
}
function makeCanvas() {
  const canvas = {
    width: 0, height: 0,
    getContext: () => makeCtx(),
    toBlob(cb) { cb(new Blob(['x'], { type: 'image/png' })); },
    toDataURL: () => 'data:image/jpeg;base64,/9j/AAAA',
  };
  return canvas;
}
for (const id of ['previewCanvas', 'editorCanvas']) {
  const c = makeCanvas();
  els[id] = Object.assign(makeEl(id), { getContext: c.getContext, toBlob: c.toBlob, toDataURL: c.toDataURL, width: 0, height: 0 });
}
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  getElementById: getEl,
  querySelectorAll: (sel) => {
    if (sel === '.screen') return ['screen-home', 'screen-analysing', 'screen-recommendations', 'screen-editor'].map(getEl);
    return [];
  },
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : makeEl(tag)),
};
globalThis.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.location = { search: '' };
globalThis.Image = class {
  constructor() { this.naturalWidth = 1024; this.naturalHeight = 768; this.width = 1024; this.height = 768; }
  set src(_) { setTimeout(() => this.onload && this.onload(), 0); }
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'large-photo-test/1.0', clipboard: { writeText: async () => {} } },
  configurable: true,
});

const uiMock = makeMock();
globalThis.__FILTERFIT_DISABLE_WORKER__ = true;
globalThis.createImageBitmap = uiMock.fn;
delete globalThis.__FILTERFIT_LOAD_TIMEOUT_MS;

await import('../src/main.js');

const uiFile = jpegFile(8000, 6000);
const uiHeapBefore = process.memoryUsage().heapUsed;
const uiStarted = performance.now();
getEl('fileInput').files = [uiFile];
getEl('fileInput').dispatch('change');
const uiDeadline = Date.now() + 4000;
while (Date.now() < uiDeadline && getEl('screen-recommendations').classList.contains('hidden')) {
  await new Promise((r) => setTimeout(r, 50));
}
const uiElapsed = performance.now() - uiStarted;
const uiHeap = process.memoryUsage().heapUsed - uiHeapBefore;
check('capture path leaves the analysing screen', getEl('screen-analysing').classList.contains('hidden'));
check('capture path reaches recommendations', !getEl('screen-recommendations').classList.contains('hidden') && getEl('top3').innerHTML.length > 20);
check('capture path shows a why-line', getEl('whyPick').textContent.length > 5, getEl('whyPick').textContent);
check(
  'capture path resized the 8000px JPEG',
  uiMock.calls.some((c) => c.resizeWidth === 2048 && c.resizeHeight === 1536),
  JSON.stringify(uiMock.calls[0]),
);
check('capture path completes in reasonable time', uiElapsed < 4000, `${uiElapsed.toFixed(0)}ms`);
check('capture path memory stays bounded', uiHeap < 48 * 1024 * 1024, `${Math.round(uiHeap / 1048576)}MB`);
check('a very large photo tells the user it was reduced', !getEl('largePhotoNote').classList.contains('hidden'));

globalThis.__FILTERFIT_LOAD_TIMEOUT_MS = 60;
globalThis.createImageBitmap = () => new Promise(() => {});
const hangStarted = performance.now();
getEl('fileInput').files = [jpegFile(12000, 9000)];
getEl('fileInput').dispatch('change');
const hangDeadline = Date.now() + 2000;
while (Date.now() < hangDeadline && getEl('photoError').textContent.length === 0) {
  await new Promise((r) => setTimeout(r, 20));
}
check(
  'a hung decode returns home with an error instead of spinning forever',
  getEl('photoError').textContent.length > 10
    && !getEl('screen-home').classList.contains('hidden')
    && getEl('screen-analysing').classList.contains('hidden')
    && performance.now() - hangStarted < 2000,
  getEl('photoError').textContent,
);

console.log(failures.length ? `\n${failures.length} FAILURES` : '\nlarge-photo: all passed');
process.exit(failures.length ? 1 : 0);
