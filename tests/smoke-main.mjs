#!/usr/bin/env node
// Headless smoke test for the app entry point (src/main.js) with a
// Proxy-free hand-rolled DOM stub. No browser, no jsdom — the stub fakes
// just enough DOM for the module to load and for the main user flows to run:
//   import photo -> analysis -> recommendations (with why-line) -> editor
//   -> intensity slider (rAF-throttled) -> save preset -> export -> history
//   -> diagnostics (?perf=1) -> preset re-apply from home
// It also asserts every getElementById() id exists in index.html.
//
// Usage: node tests/smoke-main.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const htmlIds = new Set([...readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const requestedIds = new Set();
function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c, force) => { if (force === undefined) set.has(c) ? set.delete(c) : set.add(c); else force ? set.add(c) : set.delete(c); },
    contains: (c) => set.has(c),
    _set: set,
  };
}
function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', style: {},
    dataset: {}, classList: makeClassList(), _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute() {}, removeAttribute() {},
    click() { (this._listeners.click || []).forEach((fn) => fn({ target: this })); },
    dispatch(type, event = {}) { (this._listeners[type] || []).forEach((fn) => fn({ ...event, target: this })); },
    querySelectorAll: () => [],
    files: [],
  };
  return el;
}
const els = {};
function getEl(id) {
  requestedIds.add(id);
  if (!els[id]) els[id] = makeEl(id);
  return els[id];
}
// Screen sections for showScreen().
for (const s of ['screen-home', 'screen-analysing', 'screen-recommendations', 'screen-editor']) {
  els[s] = makeEl(s);
  els[s].classList.add('hidden');
}
els['screen-home'].classList.remove('hidden');

const chipVivid = makeEl('chip-vivid'); chipVivid.dataset.filter = 'vivid';
const chipNoir = makeEl('chip-noir'); chipNoir.dataset.filter = 'noir';
const presetChip = makeEl('preset-chip'); presetChip.dataset.preset = '';

function makeCtx(w = 64, h = 64) {
  return {
    filter: '',
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4).fill(128) }),
    putImageData() {},
    clearRect() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  };
}
function makeCanvas() {
  return {
    width: 0, height: 0,
    getContext: () => makeCtx(),
    toBlob(cb) { cb(new Blob(['x'.repeat(1234)], { type: 'image/png' })); },
    toDataURL: () => 'data:image/jpeg;base64,/9j/AAAA',
  };
}

// Canvas elements need both DOM behaviour and a 2d context.
for (const id of ['previewCanvas', 'editorCanvas']) {
  const c = makeCanvas();
  const el = makeEl(id);
  els[id] = Object.assign(el, { getContext: c.getContext, toBlob: c.toBlob, toDataURL: c.toDataURL });
}
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};
global.document = {
  getElementById: getEl,
  querySelectorAll: (sel) => {
    if (sel === '.screen') return ['screen-home', 'screen-analysing', 'screen-recommendations', 'screen-editor'].map(getEl);
    if (sel === '.rec-card') return [chipVivid];
    if (sel === '#filterGrid .filter-chip') return [chipVivid, chipNoir];
    if (sel === '[data-preset]') return [presetChip];
    if (sel === '[data-history]') return [];
    return [];
  },
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : makeEl(tag)),
};
global.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
global.requestAnimationFrame = (cb) => { cb(); return 1; };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'smoke-test/1.0', clipboard: { writeText: async () => {} } }, configurable: true });
global.location = { search: '?perf=1' };
global.Image = class {
  constructor() { this.naturalWidth = 3000; this.naturalHeight = 2000; this.width = 3000; this.height = 2000; this.complete = false; }
  set src(v) { this.complete = true; setTimeout(() => this.onload && this.onload(), 0); }
};

const failures = [];
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures.push(name);
}

// 1. Module loads (wiring runs at import time).
await import('../src/main.js');
check('module loads without throwing', true);
const missing = [...requestedIds].filter((id) => !htmlIds.has(id));
check('every getElementById id exists in index.html', missing.length === 0, missing.join(',') || `${requestedIds.size} ids OK`);

// 2. Import a photo -> recommendations with a why-line.
getEl('fileInput').files = [{ name: 'test-photo.jpg' }];
getEl('fileInput').dispatch('change', { target: { files: [{ name: 'test-photo.jpg' }] } });
await new Promise((r) => setTimeout(r, 600));
check('recommendations rendered (top3 non-empty)', getEl('top3').innerHTML.length > 50);
check('why-line shown under top pick', getEl('whyPick').textContent.length > 10, getEl('whyPick').textContent);
check('recommendations screen visible', !getEl('screen-recommendations').classList.contains('hidden'));

// 3. Hold-to-compare on the recommendations preview: pointerdown shows the
//    original, pointerup restores the filtered view (no throw either way).
getEl('previewCanvas').dispatch('pointerdown');
getEl('previewCanvas').dispatch('pointerup');
check('hold-to-compare on recommendations preview runs', true);

// 4. Pick a recommendation card -> intensity becomes that filter's default.
chipVivid.dispatch('click');
check('rec card click sets intensity to filter default (Vivid 80%)', getEl('intensity').value === '80' || getEl('intensityVal').textContent === '80%', `intensity=${getEl('intensity').value}`);

// 5. Open editor, drag the intensity slider (rAF-throttled render).
getEl('openEditorBtn').click();
check('editor screen visible', !getEl('screen-editor').classList.contains('hidden'));
getEl('intensity').value = '50';
getEl('intensity').dispatch('input', { target: { value: '50' } });
check('intensity slider input renders without throwing', true);

// 6. Save a preset, then re-apply it from the home chips.
getEl('presetName').value = 'Golden porch';
getEl('savePresetBtn').click();
const presets = JSON.parse(store.get('filterfit.presets.v1') || '[]');
check('preset saved to localStorage', presets.length === 1 && presets[0].name === 'Golden porch', JSON.stringify(presets));
check('preset stores filter + intensity + tune', presets[0]?.filterId === 'vivid' && typeof presets[0]?.intensity === 'number' && !!presets[0]?.tune);
getEl('backHomeBtn').click();
presetChip.dataset.preset = presets[0].id;
presetChip.dispatch('click');
check('preset re-apply from home opens the editor', !getEl('screen-editor').classList.contains('hidden'));

// 7. Export -> history entry with thumbnail + reopenable copy.
getEl('exportBtn').click();
await new Promise((r) => setTimeout(r, 300));
const history = JSON.parse(store.get('filterfit.history.v1') || '[]');
check('export saves a history entry', history.length === 1, JSON.stringify(history[0]).slice(0, 120));
check('history entry has thumbnail + stored image', !!history[0]?.thumb && !!history[0]?.image);

// 8. Diagnostics (?perf=1) run and produce JSON.
getEl('backHomeBtn').click();
getEl('runDiagBtn').click();
await new Promise((r) => setTimeout(r, 500));
const diag = getEl('diagResults').textContent;
check('diagnostics produce results JSON', diag.includes('analysis') && diag.includes('export'), diag.slice(0, 100));

// 9. Filter library list rendered from the same data.
check('in-app filter library lists all 12 filters', (getEl('filterLibraryList').innerHTML.match(/default /g) || []).length === 12);

console.log(failures.length ? `\n${failures.length} FAILURES` : '\nsmoke test: all passed');
process.exit(failures.length ? 1 : 0);
