// In-app performance harness (step 3 of the Lab fix list).
//
// Measures the three numbers that decide whether the loop feels fast on a
// real phone: photo analysis time, live-preview render time while dragging
// the intensity slider, and full-resolution export time + memory.
//
// Nothing here is a guess: every number comes from running the real pipeline
// on the device. On low-end Android and older iPhones the numbers will be
// higher than on a desktop — that is the point of docs/perf-test-protocol.md.
// performance.memory exists only in Chromium; on iOS Safari the memory
// fields are reported as null, never invented.
import { analyzePhoto } from './analyze.js';
import { renderPreview, renderFiltered } from './filters.js';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function heapMB() {
  if (typeof performance !== 'undefined' && performance.memory) {
    return Math.round(performance.memory.usedJSHeapSize / 1048576);
  }
  return null;
}

// Median ms of analyzePhoto over `runs` runs.
export function measureAnalysis(image, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    analyzePhoto(image);
    times.push(performance.now() - t0);
  }
  return { medianMs: +median(times).toFixed(2), runs };
}

// Median ms of a capped live-preview render over `runs` runs.
export function measurePreview(image, filter, intensity = 1, tune = {}, runs = 5) {
  const canvas = document.createElement('canvas');
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    renderPreview(canvas, image, filter, intensity, tune);
    times.push(performance.now() - t0);
  }
  return { medianMs: +median(times).toFixed(2), runs, previewLongSide: 1600 };
}

// Full-resolution export: render time + PNG encode time + heap before/after.
export async function measureExport(image, filter, intensity = 1, tune = {}) {
  const canvas = document.createElement('canvas');
  const heapBefore = heapMB();
  const t0 = performance.now();
  renderFiltered(canvas, image, filter, intensity, tune);
  const renderMs = performance.now() - t0;
  const t1 = performance.now();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const encodeMs = performance.now() - t1;
  return {
    renderMs: +renderMs.toFixed(2),
    encodeMs: +encodeMs.toFixed(2),
    totalMs: +(renderMs + encodeMs).toFixed(2),
    bytes: blob ? blob.size : null,
    width: canvas.width,
    height: canvas.height,
    heapBeforeMB: heapBefore,
    heapAfterMB: heapMB(),
  };
}

// Slider-lag tracker: call recordRender(ms) after every preview render that
// a slider drag triggers; summary() reports the drag experience.
export function createSliderLagTracker() {
  const samples = [];
  return {
    record(ms) {
      samples.push(ms);
      if (samples.length > 100) samples.shift();
    },
    summary() {
      if (!samples.length) return { samples: 0, medianMs: null, p95Ms: null, over32ms: 0 };
      const sorted = [...samples].sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      return {
        samples: samples.length,
        medianMs: +median(samples).toFixed(2),
        p95Ms: +p95.toFixed(2),
        over32ms: samples.filter((ms) => ms > 32).length,
      };
    },
  };
}

// Run the full diagnostics pass on the current photo. Returns one object
// the UI renders and the user can copy as JSON.
export async function runDiagnostics(image, filter, intensity = 1, tune = {}) {
  const analysis = measureAnalysis(image);
  const preview = measurePreview(image, filter, intensity, tune);
  const exp = await measureExport(image, filter, intensity, tune);
  return {
    device: navigator.userAgent || 'unknown',
    photo: `${image.naturalWidth || image.width}x${image.naturalHeight || image.height}`,
    filter: filter ? filter.name : 'Original',
    analysis,
    preview,
    export: exp,
    measuredAt: new Date().toISOString(),
  };
}
