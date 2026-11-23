# FilterFit filter library — single source of truth

**Frozen at 12 filters.** Do not add a filter until the current set wins the
24-photo blind test in `tests/` (step 1 of the Lab fix list). The definitions
live in `src/filters.js` (`condition` + `defaultIntensity` on each entry);
this file is generated from the same data, and the in-app library list on the
home screen is rendered from the same data too — so code, doc, and app cannot
drift. If you change a condition or a default here, change it in
`src/filters.js` and re-check the in-app list.

Default intensity is the strength the app applies when the filter is picked
(top recommendation, tapping a recommendation card, or tapping a filter chip
in the editor). Moving the slider after that overrides it for that photo only.

| Filter | For this photo condition | Default intensity |
|---|---|---|
| Original | Any photo that is already right — the untouched baseline, not a look. | 100% (no-op) |
| Vivid | Colourful scenes that need more punch, or muted palettes that feel flat. | 80% |
| Warm Glow | Warm or dim photos that suit a cosy golden cast. | 80% |
| Cool Mist | Cool-toned or bright photos; calms a warm cast. | 70% |
| Golden Hour | Warm photos in mid-range light; a late-afternoon feel. | 80% |
| Noir | Low-colour or high-contrast photos where shape matters more than colour. | 100% |
| Soft Fade | Bright, low-contrast photos; a gentle, film-like finish. | 80% |
| Emerald | Green-dominant photos — landscape, foliage, parks. | 80% |
| Rosé | Warm-red dominant photos and portraits. ⚠️ **FLAGGED — heuristic only:** the app cannot detect skin or faces, so this condition is a guess from the colour cast, not a detection. Treat as a manual pick, not a recommendation to trust blindly. | 70% |
| Arctic | Bright, cool photos; snow, sky, water. | 70% |
| Moody | Low-light photos; deepens shadows for a cinematic feel. | 80% |
| Sunset | Very warm and saturated photos; golden and pink light. | 80% |

## Known overlaps — not resolved yet

- **Warm Glow / Golden Hour / Sunset** are three warm filters with overlapping
  triggers. Golden Hour wins 8 of the 24 baseline photos and the top 3 can be
  all-warm. Whether that is actually wrong is what the 3-person blind test
  decides — see `tests/blind-comparison.md` once the human picks are in. Do
  not merge or retune them on a hunch.
- **Cool Mist / Arctic** both serve bright, cool photos. Arctic is the
  stronger, brighter one; Cool Mist is the gentler correction. Same rule:
  leave them until the blind test says otherwise.

## How the app picks

`src/analyze.js` measures brightness, contrast, warmth, per-pixel saturation,
dominant colour, and a subject proxy (low-light / colourful / bright / general
— a brightness/saturation proxy, not subject detection), then scores every
filter and returns the top 3. The full rule list and the measured baseline are
in `tests/recommendation-baseline.md`. Subjects, detection method and fallback
are described in [`docs/subject-analysis.md`](docs/subject-analysis.md).
