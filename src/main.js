// FilterFit entry point: navigation, photo import, analysis, recommendations,
// editor wiring, full-resolution export and local history.
import { FILTERS, getFilter, renderFiltered } from './filters.js';
import { analyzePhoto, recommendFilters } from './analyze.js';

const $ = (id) => document.getElementById(id);
const HISTORY_KEY = 'filterfit.history.v1';

const state = {
  image: null,
  imageName: 'photo',
  analysis: null,
  recommendations: [],
  selectedFilter: 'original',
  intensity: 1,
  tune: { brightness: 0, contrast: 0, warmth: 0, saturation: 0 },
};

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  $(`screen-${name}`).classList.remove('hidden');
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveToHistory(entry) {
  const history = loadHistory();
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
}

function renderHistory() {
  const history = loadHistory();
  const el = $('historyList');
  if (!history.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<h2 class="text-sm font-semibold text-slate-300 mb-2">Recent photos</h2>' +
    history.map((h) => `<div class="flex justify-between text-sm py-2 border-b border-slate-800">
      <span class="truncate">${h.name}</span>
      <span class="text-emerald-400 shrink-0 ml-3">${h.filter} · ${h.score}%</span>
    </div>`).join('');
}

async function handleFile(file) {
  if (!file) return;
  state.imageName = file.name || 'photo';
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
    state.selectedFilter = state.recommendations[0].filter.id;
    renderRecommendations();
    showScreen('recommendations');
  }, 350);
}

function renderRecommendations() {
  renderFiltered($('previewCanvas'), state.image, getFilter(state.selectedFilter), 1);
  $('top3').innerHTML = state.recommendations.map((rec, i) => `
    <button data-filter="${rec.filter.id}" class="rec-card w-full text-left bg-slate-900 border ${i === 0 ? 'border-emerald-400' : 'border-slate-800'} rounded-xl p-4">
      <span class="flex justify-between items-center">
        <span class="font-semibold">${i + 1}. ${rec.filter.name}</span>
        <span class="text-emerald-400 font-bold">${rec.score}% match</span>
      </span>
      <span class="text-xs text-slate-400 block mt-1">${rec.reason}</span>
    </button>`).join('');
  document.querySelectorAll('.rec-card').forEach((card) => {
    card.addEventListener('click', () => {
      state.selectedFilter = card.dataset.filter;
      renderRecommendations();
    });
  });
}

function renderEditor() {
  renderFiltered($('editorCanvas'), state.image, getFilter(state.selectedFilter), state.intensity, state.tune);
  $('filterGrid').innerHTML = FILTERS.map((f) => `
    <button data-filter="${f.id}" class="filter-chip ${f.id === state.selectedFilter ? 'active' : ''}">${f.name}</button>`).join('');
  document.querySelectorAll('#filterGrid .filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.selectedFilter = chip.dataset.filter;
      renderEditor();
    });
  });
}

function readTune() {
  state.tune = {
    brightness: +$('tuneBrightness').value,
    contrast: +$('tuneContrast').value,
    warmth: +$('tuneWarmth').value,
    saturation: +$('tuneSaturation').value,
  };
}

// Import wiring
$('dropZone').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
$('libraryBtn').addEventListener('click', () => $('fileInput').click());
$('cameraBtn').addEventListener('click', () => {
  // On native builds this uses the Capacitor Camera plugin; in the browser
  // the file input with capture falls back to the camera.
  const input = $('fileInput');
  input.setAttribute('capture', 'environment');
  input.click();
  input.removeAttribute('capture');
});
$('historyBtn').addEventListener('click', () => { showScreen('home'); renderHistory(); });

// Editor wiring
$('openEditorBtn').addEventListener('click', () => { renderEditor(); showScreen('editor'); });
$('intensity').addEventListener('input', (e) => {
  state.intensity = e.target.value / 100;
  $('intensityVal').textContent = `${e.target.value}%`;
  renderEditor();
});
['tuneBrightness', 'tuneContrast', 'tuneWarmth', 'tuneSaturation'].forEach((id) => {
  $(id).addEventListener('input', () => { readTune(); renderEditor(); });
});

// Hold-to-compare: show the original while pressed.
const editorCanvas = $('editorCanvas');
editorCanvas.addEventListener('pointerdown', () => renderFiltered(editorCanvas, state.image, getFilter('original'), 1, {}));
editorCanvas.addEventListener('pointerup', () => renderEditor());
editorCanvas.addEventListener('pointerleave', () => renderEditor());

$('backHomeBtn').addEventListener('click', () => { renderHistory(); showScreen('home'); });

// Export at full resolution, then share via the native share sheet.
$('exportBtn').addEventListener('click', async () => {
  const out = document.createElement('canvas');
  renderFiltered(out, state.image, getFilter(state.selectedFilter), state.intensity, state.tune);
  const top = state.recommendations[0];
  saveToHistory({ name: state.imageName, filter: getFilter(state.selectedFilter).name, score: top ? top.score : 0, at: Date.now() });
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
