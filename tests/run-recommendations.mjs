#!/usr/bin/env node
// Recommendation baseline harness: runs the REAL src/analyze.js scoring
// (analyzePixels + recommendFilters + explainPick) over the fixed 24-photo
// test set and writes tests/recommendation-baseline.md.
//
// Usage:
//   python3 tests/decode-photos.py   # decode photos to raw RGBA first
//   node tests/run-recommendations.mjs
//
// The baseline is the app's pick BEFORE any human blind test. It is the
// reference the blind-pick comparison (tests/compare-picks.mjs) measures
// agreement against. No human picks are simulated or invented here.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyzePixels, recommendFilters, explainPick, describeSignals } from '../src/analyze.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(HERE, 'photos.json'), 'utf8'));

const rows = [];
for (const entry of manifest) {
  const raw = readFileSync(path.join(HERE, 'photos-raw', entry.file + '.rgba'));
  const pixels = new Uint8ClampedArray(raw);
  const analysis = analyzePixels(pixels);
  const recs = recommendFilters(analysis, 3);
  const top = recs[0];
  rows.push({ entry, analysis, recs, explanation: explainPick(analysis, top) });
}

const fmt = (n, d = 2) => Number(n).toFixed(d);
const sig = (a) => describeSignals(a).map((s) => s.label).join(', ') || 'none strong';

let md = `# FilterFit recommendation baseline — 24-photo test set\n\n`;
md += `Generated ${new Date().toISOString()} by \`node tests/run-recommendations.mjs\` (run \`python3 tests/decode-photos.py\` first).\n\n`;
md += `Each photo was run through the real scoring code in \`src/analyze.js\` (\`analyzePixels\` + \`recommendFilters\`). `;
md += `This is the app's pick **before** the 3-person blind test — the reference the blind-pick comparison measures agreement against. `;
md += `No human picks are in this file; human results come only from \`tests/blind-pick.html\`.\n\n`;
md += `## Rules in force when this baseline was generated\n\n`;
md += `- Scoring: base 50 + per-filter brightness/colour/warmth/contrast rules (see \`src/analyze.js\` \`scoreFilter\`).\n`;
md += `- Saturation is measured PER PIXEL and averaged (fixed 2026-11-21: the old code computed it from the channel means, which washed colour out to 0.03–0.35 even for a sunset — and Noir's bonus then won 21 of 24 photos).\n`;
md += `- Noir earns its bonus only when colour is genuinely quiet (saturation below 0.35, the low end of the observed 0.08–0.52 range); above that it earns only the contrast term. After this fix Noir wins 3/24 (all genuinely muted photos) instead of 21/24.\n`;
md += `- Rosé needs real warmth (warmth > 0.15) as well as a red-dominant cast (fixed 2026-11-21: it scored a flat 80% and sat second on ~20 of 24 photos because mean red exceeds mean green/blue in most photos).\n`;
md += `- Subject tie-breaker (added 2026-11-21 from Lab report 76: subject was computed but never used): low-light +10 Moody / +8 Noir; colourful scene +8 Vivid / +6 Sunset; bright scene +8 Arctic / +6 Soft Fade. Small bonuses only — they break near-ties, never overturn a strong signal mismatch.\n`;
md += `- \`cool-mist\` reason is now signal-conditional (was a static string that ignored the measurements).\n`;
md += `- KNOWN OPEN QUESTION (not rewritten without human evidence): Golden Hour wins 8/24 and Warm Glow / Golden Hour / Sunset are three warm filters with overlapping triggers, so the top 3 can be all-warm. Whether that is wrong is exactly what the blind test decides — see the disagreement table it produces.\n`;
md += `- Rosé is flagged in FILTER_LIBRARY.md: the app cannot detect skin or faces, so its condition is a heuristic only.\n\n`;
md += `## Results\n\n`;
md += `| Photo | Category | Bright | Warm | Sat | Contrast | Dominant | Subject | Top pick (score) | Why (signals) | Ranked alternatives |\n`;
md += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const { entry, analysis: a, recs, explanation } of rows) {
  const alts = recs.slice(1).map((r) => `${r.filter.name} ${r.score}%`).join(', ');
  md += `| ${entry.id} | ${entry.category} | ${fmt(a.brightness)} | ${fmt(a.warmth)} | ${fmt(a.saturation)} | ${fmt(a.contrast)} | ${a.dominant} | ${a.subject} | **${recs[0].filter.name} ${recs[0].score}%** | ${explanation} | ${alts} |\n`;
}
md += `\n## Signals that fired (for the rule rewrite)\n\n`;
for (const { entry, analysis: a } of rows) {
  md += `- ${entry.id} (${entry.category}): ${sig(a)}\n`;
}
md += `\n## Top-pick distribution\n\n`;
const counts = {};
for (const { recs } of rows) counts[recs[0].filter.id] = (counts[recs[0].filter.id] || 0) + 1;
for (const [id, n] of Object.entries(counts).sort((x, y) => y[1] - x[1])) {
  md += `- ${id}: ${n}/24 top picks\n`;
}
md += `\n## Test set\n\n`;
md += `24 photos, 3 per category, listed in \`tests/photos.json\` with source and verified content per photo. `;
md += `22 are picsum.photos seeds (Unsplash-sourced, free to use); the 2 food photos (pizza, burger) are generated — Wikimedia and Flickr block this machine's network range, so no openly licensed food photo could be downloaded. No personal photos are used.\n`;

writeFileSync(path.join(HERE, 'recommendation-baseline.md'), md);

// Machine-readable twin of the table above, for tests/compare-picks.mjs.
const resultsJson = {
  generatedAt: new Date().toISOString(),
  photos: rows.map(({ entry, analysis, recs }) => ({
    id: entry.id,
    category: entry.category,
    file: entry.file,
    analysis: {
      brightness: +analysis.brightness.toFixed(3),
      contrast: +analysis.contrast.toFixed(3),
      warmth: +analysis.warmth.toFixed(3),
      saturation: +analysis.saturation.toFixed(3),
      dominant: analysis.dominant,
      subject: analysis.subject,
    },
    topPick: recs[0].filter.id,
    topScore: recs[0].score,
    top3: recs.map((r) => ({ filter: r.filter.id, score: r.score })),
  })),
};
writeFileSync(path.join(HERE, 'baseline-results.json'), JSON.stringify(resultsJson, null, 2));
console.log(`baseline written: ${rows.length} photos`);
for (const { entry, recs } of rows) {
  console.log(`  ${entry.id.padEnd(16)} ${entry.category.padEnd(13)} -> ${recs[0].filter.name} ${recs[0].score}%  (alts: ${recs.slice(1).map((r) => r.filter.name).join(', ')})`);
}
