#!/usr/bin/env node
// Headless perf probe: measures the JavaScript cost of the filter pipeline
// without a browser, so the slowest step can be named with numbers.
//
// It does NOT measure a phone. Phone numbers come from the in-app
// diagnostics (?perf=1) run on the device — see docs/perf-test-protocol.md.
// What this measures: the per-pixel apply() loops from src/filters.js and
// analyzePixels() from src/analyze.js, on synthetic buffers, in Node.
// The browser runs the same JavaScript, so the RATIOS (full-res vs capped
// preview) transfer even though the absolute ms differ per device.
//
// Usage: node tests/perf-probe.mjs
import { analyzePixels } from '../src/analyze.js';
import { FILTERS } from '../src/filters.js';

function makeBuffer(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x * 255) / w;
      px[i + 1] = (y * 255) / h;
      px[i + 2] = 128;
      px[i + 3] = 255;
    }
  }
  return px;
}

function timeIt(fn, runs = 3) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

function applyLoop(px, apply, intensity) {
  for (let i = 0; i < px.length; i += 4) {
    const [nr, ng, nb] = apply(px[i], px[i + 1], px[i + 2]);
    px[i] = px[i] + (nr - px[i]) * intensity;
    px[i + 1] = px[i + 1] + (ng - px[i + 1]) * intensity;
    px[i + 2] = px[i + 2] + (nb - px[i + 2]) * intensity;
  }
}

function tuneLoop(px) {
  const c = 1.1, s = 1.1;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i], g = px[i + 1], b = px[i + 2];
    r = (r - 128) * c + 128; g = (g - 128) * c + 128; b = (b - 128) * c + 128;
    const avg = (r + g + b) / 3;
    px[i] = avg + (r - avg) * s; px[i + 1] = avg + (g - avg) * s; px[i + 2] = avg + (b - avg) * s;
  }
}

const vivid = FILTERS.find((f) => f.id === 'vivid');

const small = makeBuffer(64, 64);
console.log(`analyzePixels 64x64 (the analysis size): ${timeIt(() => analyzePixels(small)).toFixed(2)} ms`);

const full = makeBuffer(4000, 3000);
console.log(`filter apply loop, full-res 4000x3000 (12 MP, the OLD editor path): ${timeIt(() => applyLoop(full, vivid.apply, 1)).toFixed(0)} ms`);
console.log(`tune pass, full-res 4000x3000: ${timeIt(() => tuneLoop(full)).toFixed(0)} ms`);

const preview = makeBuffer(1024, 768);
console.log(`filter apply loop, capped preview 1024x768 (the NEW editor path): ${timeIt(() => applyLoop(preview, vivid.apply, 1)).toFixed(0)} ms`);
console.log(`tune pass, capped preview 1024x768: ${timeIt(() => tuneLoop(preview)).toFixed(0)} ms`);

console.log(`\nFull-res filter+tune per slider movement (old): ~${(timeIt(() => applyLoop(full, vivid.apply, 1)) + timeIt(() => tuneLoop(full))).toFixed(0)} ms — over the 16 ms frame budget, so dragging the slider stuttered.`);
console.log(`Capped preview filter+tune per slider movement (new): ~${(timeIt(() => applyLoop(preview, vivid.apply, 1)) + timeIt(() => tuneLoop(preview))).toFixed(0)} ms, plus one render per animation frame (rAF throttle).`);
console.log(`Export still renders at full resolution — that cost is paid once per export, not per slider movement.`);
