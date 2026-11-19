// On-device photo analysis + heuristic filter scoring. No server, no ML model:
// the image is downsampled to a small canvas and its pixels are measured for
// brightness, contrast, warmth, saturation and dominant colour, then each
// filter is scored against those measurements.
import { FILTERS } from './filters.js';

export function analyzePhoto(image) {
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

  let sumL = 0, sumR = 0, sumG = 0, sumB = 0, sumSq = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    sumL += l; sumR += r; sumG += g; sumB += b; sumSq += l * l;
  }
  const meanL = sumL / n;
  const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
  const variance = sumSq / n - meanL * meanL;
  const contrast = Math.sqrt(Math.max(0, variance)) / 128;

  const maxC = Math.max(meanR, meanG, meanB);
  const minC = Math.min(meanR, meanG, meanB);
  const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;
  const warmth = (meanR - meanB) / 255; // >0 warm, <0 cool

  const brightness = meanL / 255;
  const dominant = meanR > meanG && meanR > meanB ? 'warm-red'
    : meanG > meanR && meanG > meanB ? 'green'
    : meanB > meanR && meanB > meanG ? 'blue' : 'neutral';
  // Heuristic subject guess: very low brightness + low contrast reads as a
  // night/low-light shot; high saturation reads as a colourful scene.
  const subject = brightness < 0.25 ? 'low-light'
    : saturation > 0.45 ? 'colourful scene'
    : brightness > 0.8 ? 'bright scene' : 'general photo';

  return { brightness, contrast, warmth, saturation, dominant, subject };
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
      reason = 'Cools the scene down for a clean, airy feel.';
      break;
    case 'golden-hour':
      score += a.warmth * 45 + (a.brightness > 0.4 && a.brightness < 0.75 ? 15 : 0);
      reason = 'That late-afternoon glow suits this light.';
      break;
    case 'noir':
      score += (1 - a.saturation) * 40 + a.contrast * 20;
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
      score += a.dominant === 'warm-red' ? 30 : 10;
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
  return { filter, score: Math.max(0, Math.min(100, Math.round(score))), reason };
}

export function recommendFilters(analysis, topN = 3) {
  return FILTERS
    .map((f) => scoreFilter(f, analysis))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
