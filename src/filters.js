// Curated filter definitions. Each filter is a function that transforms
// per-pixel RGBA data, plus a CSS filter string used for fast live previews.
export const FILTERS = [
  { id: 'original', name: 'Original', css: 'none', apply: null },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.5) contrast(1.1)', apply: (r, g, b) => [r * 1.1, g * 1.05, b * 1.0] },
  { id: 'warm-glow', name: 'Warm Glow', css: 'sepia(0.35) saturate(1.2)', apply: (r, g, b) => [Math.min(255, r * 1.15), g, b * 0.85] },
  { id: 'cool-mist', name: 'Cool Mist', css: 'hue-rotate(-12deg) saturate(0.9)', apply: (r, g, b) => [r * 0.9, g * 0.98, Math.min(255, b * 1.12)] },
  { id: 'golden-hour', name: 'Golden Hour', css: 'sepia(0.5) brightness(1.05)', apply: (r, g, b) => [Math.min(255, r * 1.2), g * 1.05, b * 0.8] },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.25)', apply: (r, g, b) => { const v = 0.299 * r + 0.587 * g + 0.114 * b; return [v, v, v]; } },
  { id: 'soft-fade', name: 'Soft Fade', css: 'brightness(1.08) contrast(0.85) saturate(0.85)', apply: (r, g, b) => [r * 0.95 + 18, g * 0.95 + 18, b * 0.95 + 18] },
  { id: 'emerald', name: 'Emerald', css: 'hue-rotate(18deg) saturate(1.25)', apply: (r, g, b) => [r * 0.9, Math.min(255, g * 1.15), b * 0.95] },
  { id: 'rose', name: 'Rosé', css: 'sepia(0.2) hue-rotate(-25deg) saturate(1.2)', apply: (r, g, b) => [Math.min(255, r * 1.12), g * 0.95, Math.min(255, b * 1.08)] },
  { id: 'arctic', name: 'Arctic', css: 'brightness(1.1) saturate(0.8) hue-rotate(10deg)', apply: (r, g, b) => [Math.min(255, r * 1.05 + 10), Math.min(255, g * 1.05 + 10), Math.min(255, b * 1.1 + 12)] },
  { id: 'moody', name: 'Moody', css: 'brightness(0.9) contrast(1.2) saturate(0.9)', apply: (r, g, b) => [r * 0.92, g * 0.92, b * 0.95] },
  { id: 'sunset', name: 'Sunset', css: 'sepia(0.4) saturate(1.5) hue-rotate(-15deg)', apply: (r, g, b) => [Math.min(255, r * 1.25), g * 0.95, b * 0.8] },
];

export function getFilter(id) {
  return FILTERS.find((f) => f.id === id) || FILTERS[0];
}

// Render source image onto canvas with a filter at a given intensity (0..1),
// plus fine-tune adjustments in the range -50..50. Intensity blends the
// filtered result back toward the original.
export function renderFiltered(canvas, image, filter, intensity = 1, tune = {}) {
  const ctx = canvas.getContext('2d');
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.filter = 'none';
  ctx.drawImage(image, 0, 0);

  if (filter && filter.apply && intensity > 0) {
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const [nr, ng, nb] = filter.apply(px[i], px[i + 1], px[i + 2]);
      px[i] = px[i] + (nr - px[i]) * intensity;
      px[i + 1] = px[i + 1] + (ng - px[i + 1]) * intensity;
      px[i + 2] = px[i + 2] + (nb - px[i + 2]) * intensity;
    }
    ctx.putImageData(data, 0, 0);
  }

  const { brightness = 0, contrast = 0, warmth = 0, saturation = 0 } = tune;
  if (brightness || contrast || warmth || saturation) {
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const c = 1 + contrast / 100;
    const s = 1 + saturation / 100;
    for (let i = 0; i < px.length; i += 4) {
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
    ctx.putImageData(data, 0, 0);
  }
  return canvas;
}
