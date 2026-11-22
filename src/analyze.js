// On-device photo analysis + heuristic filter scoring. No server, no ML model:
// the image is downsampled to a small canvas and its pixels are measured for
// brightness, contrast, warmth, saturation and dominant colour, then each
// filter is scored against those measurements.
//
// The pixel math lives in analyzePixels(), which takes raw RGBA bytes and
// has no DOM dependency, so the same code runs in the browser and in the
// Node recommendation harness (tests/run-recommendations.mjs).
import { FILTERS } from './filters.js';

// Pure pixel analysis: px is a Uint8ClampedArray (or any array-like) of RGBA
// bytes. Returns the measured signals the scoring rules read.
export function analyzePixels(px) {
  let sumL = 0, sumR = 0, sumG = 0, sumB = 0, sumSq = 0, sumSat = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    sumL += l; sumR += r; sumG += g; sumB += b; sumSq += l * l;
    // Saturation is measured PER PIXEL and averaged. The old code computed
    // it from the channel means (max(meanR,meanG,meanB) etc.), which washes
    // colour out: averaging all pixels first turns almost every photo grey,
    // so saturation measured 0.03–0.35 even for a sunset or a plate of red
    // raspberries — and Noir's (1 − saturation) × 40 bonus then won 21 of
    // the 24 baseline photos. Per-pixel saturation is what "colourful"
    // actually means.
    const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
    sumSat += maxC === 0 ? 0 : (maxC - minC) / maxC;
  }
  const meanL = sumL / n;
  const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
  const variance = sumSq / n - meanL * meanL;
  const contrast = Math.sqrt(Math.max(0, variance)) / 128;

  const saturation = sumSat / n;
  const warmth = (meanR - meanB) / 255; // >0 warm, <0 cool

  const brightness = meanL / 255;
  const dominant = meanR > meanG && meanR > meanB ? 'warm-red'
    : meanG > meanR && meanG > meanB ? 'green'
    : meanB > meanR && meanB > meanG ? 'blue' : 'neutral';
  // Heuristic subject guess: very low brightness + low contrast reads as a
  // night/low-light shot; high saturation reads as a colourful scene.
  // NOTE: this is a brightness/saturation proxy, not subject detection — the
  // app cannot tell a portrait from a landscape. It is used only as a small
  // tie-breaker in scoring (see scoreFilter), never as a hard rule.
  const subject = brightness < 0.25 ? 'low-light'
    : saturation > 0.45 ? 'colourful scene'
    : brightness > 0.8 ? 'bright scene' : 'general photo';

  return { brightness, contrast, warmth, saturation, dominant, subject };
}

// `image` must already be the downscaled working copy (see src/photo.js).
// drawImage of a 50–200MP bitmap here is synchronous and freezes the page.
export function analyzePhoto(image) {
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  return analyzePixels(px);
}

// The measured signals that actually fired, strongest first. Each entry is
// { label, strength } — used by explainPick() and by the test harness log.
export function describeSignals(a) {
  const signals = [];
  if (a.warmth > 0.08) signals.push({ label: 'warm tones', strength: Math.abs(a.warmth) });
  else if (a.warmth < -0.08) signals.push({ label: 'cool tones', strength: Math.abs(a.warmth) });
  if (a.brightness < 0.25) signals.push({ label: 'low light', strength: 0.25 - a.brightness + 0.2 });
  else if (a.brightness > 0.8) signals.push({ label: 'very bright', strength: a.brightness - 0.8 + 0.2 });
  if (a.saturation > 0.45) signals.push({ label: 'rich colour', strength: a.saturation });
  else if (a.saturation < 0.15) signals.push({ label: 'muted colour', strength: 0.15 - a.saturation + 0.2 });
  if (a.contrast > 0.5) signals.push({ label: 'strong contrast', strength: a.contrast });
  else if (a.contrast < 0.2) signals.push({ label: 'soft contrast', strength: 0.2 - a.contrast + 0.2 });
  if (a.dominant === 'green') signals.push({ label: 'green-dominant', strength: 0.3 });
  else if (a.dominant === 'warm-red') signals.push({ label: 'red-dominant', strength: 0.3 });
  else if (a.dominant === 'blue') signals.push({ label: 'blue-dominant', strength: 0.3 });
  if (a.subject === 'low-light') signals.push({ label: 'low-light shot', strength: 0.35 });
  return signals.sort((x, y) => y.strength - x.strength);
}

// One-line, signal-based reason for the top pick, built from the signals
// that actually fired — e.g. "Warm tones + low light — Golden Hour fits best."
export function explainPick(analysis, topRec) {
  const signals = describeSignals(analysis).slice(0, 2).map((s) => s.label);
  const why = signals.length ? signals.join(' + ') : 'balanced light and colour';
  return `${capitalize(why)} — ${topRec.filter.name} fits best.`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scoreFilter(filter, a) {
  let score = 50;
  let reason = 'A balanced all-rounder for this photo.';
  switch (filter.id) {
    case 'vivid':
      score += a.saturation * 40 - Math.abs(a.brightness - 0.5) * 20;
      reason = a.saturation > 0.35
        ? 'Your photo already has rich colour — Vivid makes it pop.'
        : 'Adds punch to a fairly muted palette.';
      break;
    case 'warm-glow':
      score += a.warmth * 60 + (a.brightness < 0.45 ? 15 : 0);
      reason = a.warmth > 0
        ? 'Leans into the warm tones already in the shot.'
        : 'Adds a cosy golden warmth.';
      break;
    case 'cool-mist':
      score += -a.warmth * 60 + (a.brightness > 0.55 ? 10 : 0);
      // Was a static string that ignored the measurements; now it says what fired.
      reason = a.warmth < -0.02
        ? 'Already cool-toned — Cool Mist leans into the blue.'
        : a.brightness > 0.55
          ? 'A bright shot — cooling it down keeps it airy.'
          : 'Cools the scene down for a clean, airy feel.';
      break;
    case 'golden-hour':
      score += a.warmth * 45 + (a.brightness > 0.4 && a.brightness < 0.75 ? 15 : 0);
      reason = 'That late-afternoon glow suits this light.';
      break;
    case 'noir':
      // Was (1 − saturation) × 40 + contrast × 20: with real photos
      // measuring 0.08–0.52 saturation, that paid Noir +22 to +37 on
      // nearly every photo, so black-and-white won 21 of the 24 baseline
      // photos — including a plate of raspberries and a sunset. Noir now
      // earns its bonus only when colour is genuinely quiet (saturation
      // below 0.35, the low end of the observed range); above that it
      // earns only the contrast term.
      score += Math.max(0, 0.35 - a.saturation) * 60 + a.contrast * 15;
      reason = a.saturation < 0.3
        ? 'Colour is quiet here, so black and white lets the shapes speak.'
        : 'Strips the colour away for a dramatic monochrome look.';
      break;
    case 'soft-fade':
      score += (a.brightness > 0.6 ? 20 : 0) + (a.contrast < 0.35 ? 15 : 0);
      reason = 'Softens the light for a gentle, film-like finish.';
      break;
    case 'emerald':
      score += a.dominant === 'green' ? 35 : a.saturation * 25;
      reason = a.dominant === 'green'
        ? 'Brings out the greens that dominate this photo.'
        : 'Deepens the greens and adds richness.';
      break;
    case 'rose':
      // Was +30 whenever 'warm-red' was dominant — but mean red exceeds
      // mean green/blue in most photos, so Rosé scored a flat 80% and sat
      // second on ~20 of the 24 baseline photos. It now needs real warmth
      // (warmth > 0.15) as well as a red-dominant cast.
      score += (a.dominant === 'warm-red' && a.warmth > 0.15) ? 25 : 10;
      reason = 'A soft rosy tint that flatters skin and warm subjects.';
      break;
    case 'arctic':
      score += (a.brightness > 0.65 ? 20 : 0) + -a.warmth * 40;
      reason = 'Bright and crisp — Arctic keeps it icy and clean.';
      break;
    case 'moody':
      score += (a.brightness < 0.4 ? 25 : 0) + a.contrast * 15;
      reason = 'Deepens the shadows for a cinematic, moody feel.';
      break;
    case 'sunset':
      score += a.warmth * 50 + a.saturation * 20;
      reason = 'Turns up the golden and pink tones like sunset light.';
      break;
    default:
      score = 45;
      reason = 'The untouched original — sometimes the photo is already right.';
  }
  // Subject tie-breaker (Lab report 76: "subject" was computed but never
  // used, so it could not affect a pick). Small bonuses only — the subject
  // is a brightness/saturation proxy, not detection, so it must never
  // overturn a strong signal mismatch, only break near-ties.
  if (a.subject === 'low-light') {
    if (filter.id === 'moody') score += 10;
    if (filter.id === 'noir') score += 8;
  } else if (a.subject === 'colourful scene') {
    if (filter.id === 'vivid') score += 8;
    if (filter.id === 'sunset') score += 6;
  } else if (a.subject === 'bright scene') {
    if (filter.id === 'arctic') score += 8;
    if (filter.id === 'soft-fade') score += 6;
  }
  return { filter, score: Math.max(0, Math.min(100, Math.round(score))), reason };
}

export function recommendFilters(analysis, topN = 3) {
  return FILTERS
    .map((f) => scoreFilter(f, analysis))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
