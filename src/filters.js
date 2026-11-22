// Curated filter definitions. Each filter is a function that transforms
// per-pixel RGBA data, plus a CSS filter string used for fast live previews.
//
// THE FILTER LIBRARY IS FROZEN at these 12 entries (see FILTER_LIBRARY.md):
// do not add a filter until the current set wins the 24-photo blind test.
// `condition` is the photo condition the filter is for; `defaultIntensity`
// (0..1) is the strength the app applies when the filter is picked. The app
// reads both from here, so code and FILTER_LIBRARY.md cannot drift.
export const FILTERS = [
  { id: 'original', name: 'Original', css: 'none', condition: 'Any photo that is already right — the untouched baseline, not a look.', defaultIntensity: 1, apply: null },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.5) contrast(1.1)', condition: 'Colourful scenes that need more punch, or muted palettes that feel flat.', defaultIntensity: 0.8, apply: (r, g, b) => [r * 1.1, g * 1.05, b * 1.0] },
  { id: 'warm-glow', name: 'Warm Glow', css: 'sepia(0.35) saturate(1.2)', condition: 'Warm or dim photos that suit a cosy golden cast.', defaultIntensity: 0.8, apply: (r, g, b) => [Math.min(255, r * 1.15), g, b * 0.85] },
  { id: 'cool-mist', name: 'Cool Mist', css: 'hue-rotate(-12deg) saturate(0.9)', condition: 'Cool-toned or bright photos; calms a warm cast.', defaultIntensity: 0.7, apply: (r, g, b) => [r * 0.9, g * 0.98, Math.min(255, b * 1.12)] },
  { id: 'golden-hour', name: 'Golden Hour', css: 'sepia(0.5) brightness(1.05)', condition: 'Warm photos in mid-range light; a late-afternoon feel.', defaultIntensity: 0.8, apply: (r, g, b) => [Math.min(255, r * 1.2), g * 1.05, b * 0.8] },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.25)', condition: 'Low-colour or high-contrast photos where shape matters more than colour.', defaultIntensity: 1, apply: (r, g, b) => { const v = 0.299 * r + 0.587 * g + 0.114 * b; return [v, v, v]; } },
  { id: 'soft-fade', name: 'Soft Fade', css: 'brightness(1.08) contrast(0.85) saturate(0.85)', condition: 'Bright, low-contrast photos; a gentle, film-like finish.', defaultIntensity: 0.8, apply: (r, g, b) => [r * 0.95 + 18, g * 0.95 + 18, b * 0.95 + 18] },
  { id: 'emerald', name: 'Emerald', css: 'hue-rotate(18deg) saturate(1.25)', condition: 'Green-dominant photos — landscape, foliage, parks.', defaultIntensity: 0.8, apply: (r, g, b) => [r * 0.9, Math.min(255, g * 1.15), b * 0.95] },
  { id: 'rose', name: 'Rosé', css: 'sepia(0.2) hue-rotate(-25deg) saturate(1.2)', condition: 'Warm-red dominant photos and portraits. FLAGGED: the app cannot detect skin or faces, so this is a heuristic only — treat as a manual pick, not a recommendation to trust blindly.', defaultIntensity: 0.7, apply: (r, g, b) => [Math.min(255, r * 1.12), g * 0.95, Math.min(255, b * 1.08)] },
  { id: 'arctic', name: 'Arctic', css: 'brightness(1.1) saturate(0.8) hue-rotate(10deg)', condition: 'Bright, cool photos; snow, sky, water.', defaultIntensity: 0.7, apply: (r, g, b) => [Math.min(255, r * 1.05 + 10), Math.min(255, g * 1.05 + 10), Math.min(255, b * 1.1 + 12)] },
  { id: 'moody', name: 'Moody', css: 'brightness(0.9) contrast(1.2) saturate(0.9)', condition: 'Low-light photos; deepens shadows for a cinematic feel.', defaultIntensity: 0.8, apply: (r, g, b) => [r * 0.92, g * 0.92, b * 0.95] },
  { id: 'sunset', name: 'Sunset', css: 'sepia(0.4) saturate(1.5) hue-rotate(-15deg)', condition: 'Very warm and saturated photos; golden and pink light.', defaultIntensity: 0.8, apply: (r, g, b) => [Math.min(255, r * 1.25), g * 0.95, b * 0.8] },
];

export function getFilter(id) {
  return FILTERS.find((f) => f.id === id) || FILTERS[0];
}

// Render source image onto canvas with a filter at a given intensity (0..1),
// plus fine-tune adjustments in the range -50..50. Intensity blends the
// filtered result back toward the original.
//
// Nothing is drawn larger than this, even for export. A 12MP photo
// (~4000px) still exports at full size. A 50–200MP frame cannot allocate
// a full-frame canvas if a downscale was skipped.
export const MAX_RENDER_EDGE = 4096;

export function outputSize(image, opts = {}) {
  const w0 = image.naturalWidth || image.width || 1;
  const h0 = image.naturalHeight || image.height || 1;
  let cap = MAX_RENDER_EDGE;
  if (opts.maxSize > 0) cap = Math.min(opts.maxSize, MAX_RENDER_EDGE);
  if (Math.max(w0, h0) <= cap) return { width: w0, height: h0 };
  const long = Math.max(w0, h0);
  if (w0 >= h0) return { width: cap, height: Math.max(1, Math.round(h0 * (cap / long))) };
  return { width: Math.max(1, Math.round(w0 * (cap / long))), height: cap };
}

function applyFilterPixels(px, start, end, filter, intensity) {
  for (let i = start; i < end; i += 4) {
    const [nr, ng, nb] = filter.apply(px[i], px[i + 1], px[i + 2]);
    px[i] = px[i] + (nr - px[i]) * intensity;
    px[i + 1] = px[i + 1] + (ng - px[i + 1]) * intensity;
    px[i + 2] = px[i + 2] + (nb - px[i + 2]) * intensity;
  }
}

function applyTunePixels(px, start, end, tune) {
  const { brightness = 0, contrast = 0, warmth = 0, saturation = 0 } = tune;
  const c = 1 + contrast / 100;
  const s = 1 + saturation / 100;
  for (let i = start; i < end; i += 4) {
    let r = px[i], g = px[i + 1], b = px[i + 2];
    r = (r - 128) * c + 128 + brightness + warmth;
    g = (g - 128) * c + 128 + brightness;
    b = (b - 128) * c + 128 + brightness - warmth;
    const avg = (r + g + b) / 3;
    r = avg + (r - avg) * s;
    g = avg + (g - avg) * s;
    b = avg + (b - avg) * s;
    px[i] = Math.max(0, Math.min(255, r));
    px[i + 1] = Math.max(0, Math.min(255, g));
    px[i + 2] = Math.max(0, Math.min(255, b));
  }
}

function paintFiltered(ctx, canvas, image, filter, intensity, tune, opts) {
  const { width, height } = outputSize(image, opts);
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.filter = 'none';
  ctx.drawImage(image, 0, 0, width, height);
  return { width, height };
}

// opts.maxSize caps the longest side (live preview uses 1024). Without it,
// the result is the source size, still capped at MAX_RENDER_EDGE.
export function renderFiltered(canvas, image, filter, intensity = 1, tune = {}, opts = {}) {
  const ctx = canvas.getContext('2d');
  const { width, height } = paintFiltered(ctx, canvas, image, filter, intensity, tune, opts);

  if (filter && filter.apply && intensity > 0) {
    const data = ctx.getImageData(0, 0, width, height);
    applyFilterPixels(data.data, 0, data.data.length, filter, intensity);
    ctx.putImageData(data, 0, 0);
  }

  const { brightness = 0, contrast = 0, warmth = 0, saturation = 0 } = tune;
  if (brightness || contrast || warmth || saturation) {
    const data = ctx.getImageData(0, 0, width, height);
    applyTunePixels(data.data, 0, data.data.length, tune);
    ctx.putImageData(data, 0, 0);
  }
  return canvas;
}

function yieldToMain() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

// Same pixels as renderFiltered, but the per-pixel loops yield every few
// rows so an export of a multi-megapixel photo cannot freeze the page.
export async function renderFilteredAsync(canvas, image, filter, intensity = 1, tune = {}, opts = {}) {
  await yieldToMain();
  const ctx = canvas.getContext('2d');
  const { width, height } = paintFiltered(ctx, canvas, image, filter, intensity, tune, opts);
  const stride = Math.max(1, width) * 4;
  const chunk = 128 * stride;

  if (filter && filter.apply && intensity > 0) {
    const data = ctx.getImageData(0, 0, width, height);
    for (let start = 0; start < data.data.length; start += chunk) {
      applyFilterPixels(data.data, start, Math.min(data.data.length, start + chunk), filter, intensity);
      if (start + chunk < data.data.length) await yieldToMain();
    }
    ctx.putImageData(data, 0, 0);
  }

  const { brightness = 0, contrast = 0, warmth = 0, saturation = 0 } = tune;
  if (brightness || contrast || warmth || saturation) {
    const data = ctx.getImageData(0, 0, width, height);
    for (let start = 0; start < data.data.length; start += chunk) {
      applyTunePixels(data.data, start, Math.min(data.data.length, start + chunk), tune);
      if (start + chunk < data.data.length) await yieldToMain();
    }
    ctx.putImageData(data, 0, 0);
  }
  return canvas;
}

// Live preview: same pipeline as export, capped at 1024 px on the long side.
export function renderPreview(canvas, image, filter, intensity = 1, tune = {}) {
  return renderFiltered(canvas, image, filter, intensity, tune, { maxSize: 1024 });
}
