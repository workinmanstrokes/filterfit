// FilterFit entry point: navigation, photo import, analysis, recommendations,
// editor wiring, full-resolution export, local history, presets, and the
// performance diagnostics harness (behind ?perf=1).
import { FILTERS, getFilter, renderFiltered, renderPreview } from './filters.js';
import { analyzePhoto, recommendFilters, explainPick } from './analyze.js';
import { runDiagnostics, createSliderLagTracker } from './perf.js';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

const $ = (id) => document.getElementById(id);
const HISTORY_KEY = 'filterfit.history.v1';
const PRESETS_KEY = 'filterfit.presets.v1';
const MAX_HISTORY_WITH_IMAGE = 10;

const state = {
  image: null,
  imageName: 'photo',
  analysis: null,
  recommendations: [],
  selectedFilter: 'original',
  intensity: 1,
  tune: { brightness: 0, contrast: 0, warmth: 0, saturation: 0 },
  pendingPreset: null,
  reopenedFromHistory: false,
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
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full / private mode */ }
}
function loadHistory() { return loadJSON(HISTORY_KEY); }
function loadPresets() { return loadJSON(PRESETS_KEY); }

// Downscaled copies of the current photo for history: a 160 px thumbnail
// for the recents strip and a 1024 px copy so a recent can be reopened.
function makeStoredCopies(image) {
  const out = {};
  for (const [key, max] of [['thumb', 160], ['image', 1024]]) {
    const w0 = image.naturalWidth || image.width;
    const h0 = image.naturalHeight || image.height;
    const s = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * s));
    c.height = Math.max(1, Math.round(h0 * s));
    c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
    out[key] = c.toDataURL('image/jpeg', 0.8);
  }
  return out;
}

function saveToHistory(entry) {
  const history = loadHistory();
  history.unshift(entry);
  saveJSON(HISTORY_KEY, history.slice(0, MAX_HISTORY_WITH_IMAGE));
}

// ---------- Recents strip ----------
function renderHistory() {
  const history = loadHistory();
  const el = $('historyList');
  if (!history.length) { el.innerHTML = ''; return; }
  const thumbs = history.filter((h) => h.thumb).map((h, i) => `
    <button data-history="${i}" class="shrink-0 w-20 text-left">
      <img src="${h.thumb}" alt="" class="w-20 h-20 object-cover rounded-xl border border-slate-800">
      <span class="block text-[11px] text-slate-400 truncate mt-1">${escapeHtml(h.name)}</span>
      <span class="block text-[11px] text-emerald-400 truncate">${escapeHtml(h.filter)}</span>
    </button>`).join('');
  const textRows = history.filter((h) => !h.thumb).map((h) => `
    <div class="flex justify-between text-sm py-2 border-b border-slate-800">
      <span class="truncate">${escapeHtml(h.name)}</span>
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
    state.image = img;
    state.imageName = entry.name;
    state.reopenedFromHistory = true;
    runAnalysis();
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
      <span class="text-xs text-slate-400 block mt-0.5">${escapeHtml(f.condition)}</span>
    </div>`).join('');
}

// ---------- Photo flow ----------
async function handleFile(file) {
  if (!file) return;
  state.imageName = file.name || 'photo';
  state.reopenedFromHistory = false;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.image = img;
    URL.revokeObjectURL(url);
    runAnalysis();
  };
  img.src = url;
}

function runAnalysis() {
  showScreen('analysing');
  // Let the analysing screen paint before the (fast) synchronous analysis.
  setTimeout(() => {
    state.analysis = analyzePhoto(state.image);
    state.recommendations = recommendFilters(state.analysis, 3);
    // The top pick opens at its filter's default intensity, not 100%.
    state.selectedFilter = state.recommendations[0].filter.id;
    state.intensity = getFilter(state.selectedFilter).defaultIntensity;
    state.tune = { brightness: 0, contrast: 0, warmth: 0, saturation: 0 };
    syncTuneInputs();
    renderRecommendations();
    showScreen('recommendations');
    if (state.pendingPreset) {
      const preset = state.pendingPreset;
      state.pendingPreset = null;
      applyPreset(preset);
    }
  }, 350);
}

function renderRecommendations() {
  renderPreview($('previewCanvas'), state.image, getFilter(state.selectedFilter), state.intensity, state.tune);
  const top = state.recommendations[0];
  $('whyPick').textContent = top ? explainPick(state.analysis, top) : '';
  $('reopenedNote').classList.toggle('hidden', !state.reopenedFromHistory);
  $('top3').innerHTML = state.recommendations.map((rec, i) => `
    <button data-filter="${rec.filter.id}" class="rec-card w-full text-left bg-slate-900 border ${i === 0 ? 'border-emerald-400' : 'border-slate-800'} rounded-xl p-4">
      <span class="flex justify-between items-center">
        <span class="font-semibold">${i + 1}. ${rec.filter.name}</span>
        <span class="text-emerald-400 font-bold">${rec.score}% match</span>
      </span>
      <span class="text-xs text-slate-400 block mt-1">${escapeHtml(rec.reason)}</span>
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

function renderEditor() {
  renderPreview($('editorCanvas'), state.image, getFilter(state.selectedFilter), state.intensity, state.tune);
  $('filterGrid').innerHTML = FILTERS.map((f) => `
    <button data-filter="${f.id}" class="filter-chip ${f.id === state.selectedFilter ? 'active' : ''}">${escapeHtml(f.name)}</button>`).join('');
  document.querySelectorAll('#filterGrid .filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.selectedFilter = chip.dataset.filter;
      state.intensity = getFilter(state.selectedFilter).defaultIntensity;
      syncTuneInputs();
      renderEditor();
    });
  });
  $('intensity').value = Math.round(state.intensity * 100);
  $('intensityVal').textContent = `${Math.round(state.intensity * 100)}%`;
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
    renderEditor();
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
      await new Promise((resolve) => { if (image.complete) resolve(); else image.onload = resolve; });
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
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source,
    });
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
$('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
$('libraryBtn').addEventListener('click', async () => {
  const r = await pickPhotoNative(CameraSource.Photos);
  if (r === 'unavailable') $('fileInput').click();
});
$('cameraBtn').addEventListener('click', async () => {
  const r = await pickPhotoNative(CameraSource.Camera);
  if (r === 'unavailable') {
    // Web fallback: the file input with capture opens the camera.
    const input = $('fileInput');
    input.setAttribute('capture', 'environment');
    input.click();
    input.removeAttribute('capture');
  }
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
bindHoldToCompare($('editorCanvas'), renderEditor);

// Preset wiring (editor).
$('savePresetBtn').addEventListener('click', () => {
  savePreset($('presetName').value);
  $('presetName').value = '';
  $('presetSavedMsg').textContent = 'Preset saved — find it on the home screen.';
  setTimeout(() => { $('presetSavedMsg').textContent = ''; }, 3000);
});

$('backHomeBtn').addEventListener('click', () => { renderHistory(); renderPresets(); showScreen('home'); });

// Export at full resolution, then share via the native share sheet.
$('exportBtn').addEventListener('click', async () => {
  const out = document.createElement('canvas');
  renderFiltered(out, state.image, getFilter(state.selectedFilter), state.intensity, state.tune);
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
  out.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `filterfit-${Date.now()}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'FilterFit' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }, 'image/png');
});

renderHistory();
renderPresets();
renderFilterLibrary();
initDiagnostics();
