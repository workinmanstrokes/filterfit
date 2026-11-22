// FilterFit entry point: navigation, photo import, analysis, recommendations,
// editor wiring, full-resolution export, local history, presets, and the
// performance diagnostics harness (behind ?perf=1).
import { FILTERS, getFilter, renderPreview, renderThumb, renderFilteredAsync } from './filters.js';
import { analyzePhoto, recommendFilters, explainPick } from './analyze.js';
import { runDiagnostics, createSliderLagTracker } from './perf.js';
import { loadPhoto, releaseImage, EXPORT_LONG_EDGE, WORKING_LONG_EDGE, cameraGetPhotoOptions, PhotoLoadError, fitLongEdge } from './photo.js';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

const $ = (id) => document.getElementById(id);
const HISTORY_KEY = 'filterfit.history.v1';
const PRESETS_KEY = 'filterfit.presets.v1';
const MAX_HISTORY_WITH_IMAGE = 10;

const state = {
  image: null,
  imageName: 'photo',
  // Original file, when we still have it. Export re-decodes this up to
  // EXPORT_LONG_EDGE. Null for history reopens and for the diagnostics image.
  sourceFile: null,
  sourceWidth: 0,
  sourceHeight: 0,
  analysis: null,
  recommendations: [],
  selectedFilter: 'original',
  intensity: 1,
  tune: { brightness: 0, contrast: 0, warmth: 0, saturation: 0 },
  pendingPreset: null,
  reopenedFromHistory: false,
  exporting: false,
};

const sliderLag = createSliderLagTracker();

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  $(`screen-${name}`).classList.remove('hidden');
}

// ---------- Storage helpers ----------
function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function loadHistory() { return loadJSON(HISTORY_KEY); }
function loadPresets() { return loadJSON(PRESETS_KEY); }

// History stores JPEG thumbnails only: 160px in the recents strip and 512px
// to reopen. A full working image (and never the camera original) would blow
// the localStorage quota and jank the main thread on the way into it.
const HISTORY_THUMB_EDGE = 160;
const HISTORY_REOPEN_EDGE = 512;

function canvasToJpeg(image, maxEdge, quality) {
  const w0 = image.naturalWidth || image.width || 1;
  const h0 = image.naturalHeight || image.height || 1;
  const fitted = fitLongEdge(w0, h0, maxEdge);
  const c = document.createElement('canvas');
  c.width = fitted.width;
  c.height = fitted.height;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(image, 0, 0, c.width, c.height);
  try {
    const url = c.toDataURL('image/jpeg', quality);
    if (!url || url.length > 180000) return '';
    return url;
  } catch {
    return '';
  }
}

function makeStoredCopies(image) {
  return {
    thumb: canvasToJpeg(image, HISTORY_THUMB_EDGE, 0.72),
    image: canvasToJpeg(image, HISTORY_REOPEN_EDGE, 0.74),
  };
}

function saveToHistory(entry) {
  const history = loadHistory();
  history.unshift(entry);
  let kept = history.slice(0, MAX_HISTORY_WITH_IMAGE);
  while (kept.length && !saveJSON(HISTORY_KEY, kept)) {
    const oldest = kept[kept.length - 1];
    if (oldest && oldest.image) {
      oldest.image = '';
      if (saveJSON(HISTORY_KEY, kept)) return;
    }
    kept = kept.slice(0, -1);
  }
}

// ---------- Recents strip ----------
function renderHistory() {
  const history = loadHistory();
  const el = $('historyList');
  if (!history.length) { el.innerHTML = ''; return; }
  const thumbs = history.filter((h) => h.thumb).map((h, i) => `
    <button data-history="${i}" class="shrink-0 w-20 text-left">
      <img src="${h.thumb}" alt="" class="w-20 h-20 object-cover rounded-xl border border-slate-800">
      <span class="block text-xs text-slate-400 truncate mt-1">${escapeHtml(h.name)}</span>
      <span class="block text-xs text-emerald-400 truncate">${escapeHtml(h.filter)}</span>
    </button>`).join('');
  const textRows = history.filter((h) => !h.thumb).map((h) => `
    <div class="flex justify-between text-sm py-2 border-b border-slate-800">
      <span class="truncate min-w-0">${escapeHtml(h.name)}</span>
      <span class="text-emerald-400 shrink-0 ml-3">${escapeHtml(h.filter)} · ${h.score}%</span>
    </div>`).join('');
  el.innerHTML = '<h2 class="text-sm font-semibold text-slate-300 mb-2">Recent photos</h2>' +
    (thumbs ? `<div class="flex gap-3 overflow-x-auto pb-2">${thumbs}</div>` : '') + textRows;
  el.querySelectorAll('[data-history]').forEach((btn) => {
    btn.addEventListener('click', () => reopenFromHistory(+btn.dataset.history));
  });
}

function reopenFromHistory(index) {
  const entry = loadHistory()[index];
  if (!entry || !entry.image) return;
  const img = new Image();
  img.onload = () => {
    releaseImage(state.image);
    thumbToken += 1;
    state.image = img;
    state.imageName = entry.name;
    state.sourceFile = null;
    state.sourceWidth = img.naturalWidth || img.width || 0;
    state.sourceHeight = img.naturalHeight || img.height || 0;
    state.reopenedFromHistory = true;
    syncLargePhotoNote();
    runAnalysis();
  };
  img.onerror = () => {
    showPhotoError("Couldn't open that saved photo. Try another one.");
    showScreen('home');
  };
  img.src = entry.image;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Presets ----------
function renderPresets() {
  const presets = loadPresets();
  const chips = presets.length
    ? presets.map((p) => `<button data-preset="${p.id}" class="preset-chip">${escapeHtml(p.name)} · ${escapeHtml(getFilter(p.filterId).name)}</button>`).join('')
    : '<p class="text-xs text-slate-500">No presets yet — tune a photo in the editor and save it as a preset.</p>';
  const homeEl = $('presetList');
  if (homeEl) homeEl.innerHTML = chips;
  const editorEl = $('presetChipsEditor');
  if (editorEl) editorEl.innerHTML = presets.length ? chips : '';
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = loadPresets().find((p) => p.id === btn.dataset.preset);
      if (!preset) return;
      if (state.image) { applyPreset(preset); return; }
      state.pendingPreset = preset;
      pickPhotoNative(CameraSource.Photos).then((r) => { if (r === 'unavailable') $('fileInput').click(); });
    });
  });
}

function applyPreset(preset) {
  state.selectedFilter = preset.filterId;
  state.intensity = preset.intensity;
  state.tune = { ...preset.tune };
  syncTuneInputs();
  if (state.analysis) {
    renderEditor();
    showScreen('editor');
  }
}

function savePreset(name) {
  const presets = loadPresets();
  presets.unshift({
    id: `p${Date.now()}`,
    name: name.trim() || getFilter(state.selectedFilter).name,
    filterId: state.selectedFilter,
    intensity: state.intensity,
    tune: { ...state.tune },
    createdAt: Date.now(),
  });
  saveJSON(PRESETS_KEY, presets.slice(0, 20));
  renderPresets();
}

// ---------- Filter library (in-app, generated from the same FILTERS data
// as FILTER_LIBRARY.md, so the two cannot drift) ----------
function renderFilterLibrary() {
  const el = $('filterLibraryList');
  if (!el) return;
  el.innerHTML = FILTERS.map((f) => `
    <div class="py-2 border-b border-slate-800">
      <span class="text-sm font-semibold">${escapeHtml(f.name)}</span>
      <span class="text-xs text-emerald-400 ml-2">default ${Math.round(f.defaultIntensity * 100)}%</span>
      <span class="text-sm text-slate-400 block mt-0.5">${escapeHtml(f.condition)}</span>
    </div>`).join('');
}

// ---------- Photo flow ----------
let loadGeneration = 0;
let inflightPick = '';

function photoErrorMessage(err) {
  if (err instanceof PhotoLoadError && err.code === 'timeout') {
    return 'That photo took too long to open. Try another one.';
  }
  if (err instanceof PhotoLoadError && err.code === 'empty') return 'Choose a photo to continue.';
  return "Couldn't open that photo. Try another one.";
}

function showPhotoError(message) {
  const el = $('photoError');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function clearPhotoError() {
  showPhotoError('');
}

function setAnalyseStatus(title, detail) {
  const titleEl = $('analyseTitle');
  const detailEl = $('analyseStatus');
  if (titleEl && title) titleEl.textContent = title;
  if (detailEl && detail) detailEl.textContent = detail;
}

function syncLargePhotoNote() {
  const huge = Math.max(state.sourceWidth || 0, state.sourceHeight || 0) > EXPORT_LONG_EDGE;
  for (const id of ['largePhotoNote', 'largePhotoNoteEditor']) {
    const el = $(id);
    if (el) el.classList.toggle('hidden', !huge);
  }
}

function nextPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    } else {
      setTimeout(resolve, 16);
    }
  });
}

function pickKey(file) {
  return `${file.name || ''}:${file.size || 0}:${file.lastModified || 0}`;
}

async function handleFile(file) {
  if (!file) return;
  const key = pickKey(file);
  // A restored Android tab can deliver the same camera file twice. The second
  // copy must not start another full decode.
  if (key && key === inflightPick) return;
  inflightPick = key;
  const generation = ++loadGeneration;
  clearPhotoError();
  state.imageName = file.name || 'photo';
  state.reopenedFromHistory = false;
  setAnalyseStatus('Opening your photo…', 'Preparing a smaller copy so the phone stays responsive.');
  showScreen('analysing');
  // Paint the analysing screen before any decode work starts.
  await nextPaint();
  if (generation !== loadGeneration) return;
  try {
    const loaded = await loadPhoto(file);
    if (generation !== loadGeneration) {
      releaseImage(loaded.image);
      return;
    }
    releaseImage(state.image);
    thumbToken += 1;
    state.image = loaded.image;
    state.sourceFile = typeof file.slice === 'function' ? file : null;
    state.sourceWidth = loaded.sourceWidth || loaded.width;
    state.sourceHeight = loaded.sourceHeight || loaded.height;
    syncLargePhotoNote();
    runAnalysis();
  } catch (err) {
    if (generation !== loadGeneration) return;
    showPhotoError(photoErrorMessage(err));
    showScreen('home');
  } finally {
    if (inflightPick === key) inflightPick = '';
  }
}

function runAnalysis() {
  setAnalyseStatus('Finding your filter…', 'Brightness, colour and warmth — measured on this device.');
  showScreen('analysing');
  // Let the analysing screen paint before the (fast) synchronous analysis.
  setTimeout(() => {
    try {
      if (!state.image) throw new Error('no image');
      state.analysis = analyzePhoto(state.image);
      state.recommendations = recommendFilters(state.analysis, 3);
      // The top pick opens at its filter's default intensity, not 100%.
      state.selectedFilter = state.recommendations[0].filter.id;
      state.intensity = getFilter(state.selectedFilter).defaultIntensity;
      state.tune = { brightness: 0, contrast: 0, warmth: 0, saturation: 0 };
      syncTuneInputs();
      renderRecommendations();
      syncLargePhotoNote();
      showScreen('recommendations');
      if (state.pendingPreset) {
        const preset = state.pendingPreset;
        state.pendingPreset = null;
        applyPreset(preset);
      }
    } catch {
      showPhotoError("Couldn't open that photo. Try another one.");
      showScreen('home');
    }
  }, 350);
}

let thumbToken = 0;

function markActiveChips() {
  document.querySelectorAll('#filterGrid .filter-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.filter === state.selectedFilter);
  });
}

function renderRecommendations() {
  renderPreview($('previewCanvas'), state.image, getFilter(state.selectedFilter), state.intensity, state.tune);
  const top = state.recommendations[0];
  $('whyPick').textContent = top ? explainPick(state.analysis, top) : '';
  $('reopenedNote').classList.toggle('hidden', !state.reopenedFromHistory);
  $('top3').innerHTML = state.recommendations.map((rec, i) => `
    <button data-filter="${rec.filter.id}" class="rec-card w-full text-left bg-slate-900 border ${i === 0 ? 'border-emerald-400' : 'border-slate-800'} rounded-xl p-4">
      <span class="flex justify-between items-center gap-3">
        <span class="font-semibold min-w-0 truncate">${i + 1}. ${escapeHtml(rec.filter.name)}</span>
        <span class="text-emerald-400 font-bold shrink-0">${rec.score}% match</span>
      </span>
      <span class="text-sm text-slate-400 block mt-1">${escapeHtml(rec.reason)}</span>
    </button>`).join('');
  document.querySelectorAll('.rec-card').forEach((card) => {
    card.addEventListener('click', () => {
      state.selectedFilter = card.dataset.filter;
      state.intensity = getFilter(state.selectedFilter).defaultIntensity;
      syncTuneInputs();
      renderRecommendations();
    });
  });
}

function paintEditor() {
  renderPreview($('editorCanvas'), state.image, getFilter(state.selectedFilter), state.intensity, state.tune);
  $('intensity').value = Math.round(state.intensity * 100);
  $('intensityVal').textContent = `${Math.round(state.intensity * 100)}%`;
  markActiveChips();
}

function renderEditor() {
  paintEditor();
  const grid = $('filterGrid');
  if (grid.dataset.token === String(thumbToken) && grid.childElementCount) return;
  grid.dataset.token = String(thumbToken);
  grid.innerHTML = FILTERS.map((f) => `
    <button type="button" data-filter="${f.id}" class="filter-chip ${f.id === state.selectedFilter ? 'active' : ''}">
      <canvas class="filter-thumb" width="1" height="1" aria-hidden="true"></canvas>
      <span>${escapeHtml(f.name)}</span>
    </button>`).join('');
  grid.querySelectorAll('.filter-chip').forEach((chip) => {
    const thumb = chip.querySelector('canvas');
    renderThumb(thumb, state.image, getFilter(chip.dataset.filter));
    chip.addEventListener('click', () => {
      state.selectedFilter = chip.dataset.filter;
      state.intensity = getFilter(state.selectedFilter).defaultIntensity;
      syncTuneInputs();
      paintEditor();
    });
  });
}

function syncTuneInputs() {
  $('intensity').value = Math.round(state.intensity * 100);
  $('intensityVal').textContent = `${Math.round(state.intensity * 100)}%`;
  $('tuneBrightness').value = state.tune.brightness;
  $('tuneContrast').value = state.tune.contrast;
  $('tuneWarmth').value = state.tune.warmth;
  $('tuneSaturation').value = state.tune.saturation;
}

function readTune() {
  state.tune = {
    brightness: +$('tuneBrightness').value,
    contrast: +$('tuneContrast').value,
    warmth: +$('tuneWarmth').value,
    saturation: +$('tuneSaturation').value,
  };
}

// One rAF-throttled render for every slider movement: without this, every
// input event ran a full render synchronously, so dragging the slider queued
// up renders faster than the screen could show them. Now at most one render
// runs per animation frame, and its duration is logged for the perf harness.
let editorRenderQueued = false;
function scheduleEditorRender() {
  if (editorRenderQueued) return;
  editorRenderQueued = true;
  requestAnimationFrame(() => {
    editorRenderQueued = false;
    const t0 = performance.now();
    paintEditor();
    sliderLag.record(performance.now() - t0);
  });
}

// Hold-to-compare: show the original while pressed, filtered on release.
// Used on both the recommendations preview and the editor canvas.
function bindHoldToCompare(canvas, renderFn) {
  const showOriginal = () => renderPreview(canvas, state.image, getFilter('original'), 1, {});
  canvas.addEventListener('pointerdown', showOriginal);
  canvas.addEventListener('pointerup', renderFn);
  canvas.addEventListener('pointerleave', renderFn);
  canvas.addEventListener('pointercancel', renderFn);
}

// ---------- Diagnostics (?perf=1) ----------
function syntheticTestImage() {
  // A 3000x2000 gradient + noise image, so diagnostics can run with no photo
  // loaded. Labelled synthetic in the output — never presented as a real photo.
  const c = document.createElement('canvas');
  c.width = 3000; c.height = 2000;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 3000, 2000);
  g.addColorStop(0, '#e8b06a'); g.addColorStop(0.5, '#7a9cc4'); g.addColorStop(1, '#2c3e50');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 3000, 2000);
  const img = new Image();
  img.src = c.toDataURL('image/png');
  img._synthetic = true;
  return img;
}

function initDiagnostics() {
  if (!new URLSearchParams(location.search).has('perf')) return;
  $('diagnostics').classList.remove('hidden');
  $('runDiagBtn').addEventListener('click', async () => {
    const btn = $('runDiagBtn');
    btn.disabled = true;
    btn.textContent = 'Running…';
    try {
      const image = state.image || syntheticTestImage();
      // HTMLImageElement.complete is false until decode. A canvas or
      // ImageBitmap (the downscaled working photo) is already drawable.
      if (image && image.complete === false) {
        await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
      }
      const results = await runDiagnostics(image, getFilter(state.selectedFilter), state.intensity, state.tune);
      results.syntheticPhoto = !!image._synthetic;
      results.sliderLag = sliderLag.summary();
      $('diagResults').textContent = JSON.stringify(results, null, 2);
      $('copyDiagBtn').classList.remove('hidden');
      $('copyDiagBtn').onclick = () => navigator.clipboard?.writeText(JSON.stringify(results, null, 2));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run diagnostics';
    }
  });
}

// ---------- Native photo picking ----------
// On a native build (Android / iOS) the Capacitor Camera plugin opens the
// system camera or photo picker directly. On the web the same buttons fall
// back to the file input, so the flow is identical everywhere: the picked
// photo always goes through handleFile() and the same analysis pipeline.
// Returns 'picked', 'cancelled', or 'unavailable' (not a native build, or
// the plugin failed). A cancel must NOT fall through to the file input —
// the user said no once already.
async function pickPhotoNative(source) {
  if (!Capacitor.isNativePlatform()) return 'unavailable';
  try {
    const photo = await Camera.getPhoto(cameraGetPhotoOptions(source, CameraResultType.Uri));
    if (!photo.webPath) return 'cancelled';
    const res = await fetch(photo.webPath);
    const blob = await res.blob();
    await handleFile(new File([blob], `photo-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' }));
    return 'picked';
  } catch (e) {
    if (/cancel/i.test(String((e && e.message) || ''))) return 'cancelled';
    return 'unavailable';
  }
}

// ---------- Wiring ----------
// Import wiring
$('dropZone').addEventListener('click', async () => {
  const r = await pickPhotoNative(CameraSource.Photos);
  if (r === 'unavailable') $('fileInput').click();
});
function onPhotoChosen(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  // Allow picking the same file again next time.
  input.value = '';
  handleFile(file);
}
// Web / Chrome: a real file, never a base64 camera result. The camera input
// keeps capture="environment" so Android opens the camera; removing it in
// the same turn races the picker and drops the photo back onto the main thread.
$('fileInput').addEventListener('change', onPhotoChosen);
$('cameraInput').addEventListener('change', onPhotoChosen);
$('libraryBtn').addEventListener('click', async () => {
  const r = await pickPhotoNative(CameraSource.Photos);
  if (r === 'unavailable') $('fileInput').click();
});
$('cameraBtn').addEventListener('click', async () => {
  const r = await pickPhotoNative(CameraSource.Camera);
  if (r === 'unavailable') $('cameraInput').click();
});
$('historyBtn').addEventListener('click', () => { showScreen('home'); renderHistory(); });

// Editor wiring
$('openEditorBtn').addEventListener('click', () => { renderEditor(); showScreen('editor'); });
$('intensity').addEventListener('input', (e) => {
  state.intensity = e.target.value / 100;
  $('intensityVal').textContent = `${e.target.value}%`;
  scheduleEditorRender();
});
['tuneBrightness', 'tuneContrast', 'tuneWarmth', 'tuneSaturation'].forEach((id) => {
  $(id).addEventListener('input', () => { readTune(); scheduleEditorRender(); });
});

// Hold-to-compare on both preview canvases.
bindHoldToCompare($('previewCanvas'), renderRecommendations);
bindHoldToCompare($('editorCanvas'), paintEditor);

const pageEvents = globalThis.window;
if (pageEvents && pageEvents.addEventListener) pageEvents.addEventListener('pagehide', () => {
  // Android Chrome often discards the tab while the camera app is open.
  // Cancel the in-flight decode so a restored page cannot resume it.
  loadGeneration += 1;
  inflightPick = '';
});
if (pageEvents && pageEvents.addEventListener) pageEvents.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  loadGeneration += 1;
  inflightPick = '';
  const camera = $('cameraInput');
  const library = $('fileInput');
  if (camera) camera.value = '';
  if (library) library.value = '';
  if (!state.image) showScreen('home');
});

// Preset wiring (editor).
$('savePresetBtn').addEventListener('click', () => {
  savePreset($('presetName').value);
  $('presetName').value = '';
  $('presetSavedMsg').textContent = 'Preset saved — find it on the home screen.';
  setTimeout(() => { $('presetSavedMsg').textContent = ''; }, 3000);
});

$('backHomeBtn').addEventListener('click', () => { renderHistory(); renderPresets(); showScreen('home'); });

function setExportMsg(message) {
  const el = $('exportMsg');
  if (el) el.textContent = message || '';
}

// Export re-decodes the original file when we still have it, capped so a
// 50–200MP photo cannot be rendered at full frame. The editor keeps using
// the smaller working image.
async function imageForExport() {
  const edge = Math.max(state.sourceWidth || 0, state.sourceHeight || 0);
  if (!state.sourceFile || edge <= WORKING_LONG_EDGE) return { image: state.image, release: false, shrunk: false };
  try {
    const loaded = await loadPhoto(state.sourceFile, { maxEdge: Math.min(edge, EXPORT_LONG_EDGE) });
    return {
      image: loaded.image,
      release: true,
      shrunk: edge > EXPORT_LONG_EDGE,
    };
  } catch {
    return { image: state.image, release: false, shrunk: true };
  }
}

// Export, then share via the native share sheet. Pixel work yields between
// chunks so the button can show progress and the page stays responsive.
$('exportBtn').addEventListener('click', async () => {
  if (state.exporting || !state.image) return;
  state.exporting = true;
  const btn = $('exportBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Exporting…';
  setExportMsg('');
  let exportImage = state.image;
  let releaseExport = false;
  try {
    const prepared = await imageForExport();
    exportImage = prepared.image;
    releaseExport = prepared.release;
    const out = document.createElement('canvas');
    await renderFilteredAsync(out, exportImage, getFilter(state.selectedFilter), state.intensity, state.tune);
    const blob = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('export-timeout')), 30000);
      out.toBlob((result) => {
        clearTimeout(timer);
        resolve(result);
      }, 'image/png');
    });
    if (!blob) throw new Error('export-empty');
    const top = state.recommendations[0];
    const copies = makeStoredCopies(state.image);
    saveToHistory({
      name: state.imageName,
      filter: getFilter(state.selectedFilter).name,
      score: top ? top.score : 0,
      at: Date.now(),
      thumb: copies.thumb,
      image: copies.image,
    });
    const file = new File([blob], `filterfit-${Date.now()}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'FilterFit' });
      } catch (err) {
        if (!err || err.name !== 'AbortError') setExportMsg('Could not open the share sheet. The photo is saved in Recent photos.');
      }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    if (prepared.shrunk && !$('exportMsg').textContent) {
      setExportMsg('Exported a smaller copy — the original photo was too large.');
    }
  } catch {
    setExportMsg("Couldn't export that photo. Try again.");
  } finally {
    if (releaseExport) releaseImage(exportImage);
    state.exporting = false;
    btn.disabled = false;
    btn.textContent = label;
  }
});

renderHistory();
renderPresets();
renderFilterLibrary();
clearPhotoError();
syncLargePhotoNote();
setExportMsg('');
initDiagnostics();
