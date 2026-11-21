# FilterFit recommendation baseline — 24-photo test set

Generated 2026-11-21T21:52:49.176Z by `node tests/run-recommendations.mjs` (run `python3 tests/decode-photos.py` first).

Each photo was run through the real scoring code in `src/analyze.js` (`analyzePixels` + `recommendFilters`). This is the app's pick **before** the 3-person blind test — the reference the blind-pick comparison measures agreement against. No human picks are in this file; human results come only from `tests/blind-pick.html`.

## Rules in force when this baseline was generated

- Scoring: base 50 + per-filter brightness/colour/warmth/contrast rules (see `src/analyze.js` `scoreFilter`).
- Saturation is measured PER PIXEL and averaged (fixed 2026-11-21: the old code computed it from the channel means, which washed colour out to 0.03–0.35 even for a sunset — and Noir's bonus then won 21 of 24 photos).
- Noir earns its bonus only when colour is genuinely quiet (saturation below 0.35, the low end of the observed 0.08–0.52 range); above that it earns only the contrast term. After this fix Noir wins 3/24 (all genuinely muted photos) instead of 21/24.
- Rosé needs real warmth (warmth > 0.15) as well as a red-dominant cast (fixed 2026-11-21: it scored a flat 80% and sat second on ~20 of 24 photos because mean red exceeds mean green/blue in most photos).
- Subject tie-breaker (added 2026-11-21 from Lab report 76: subject was computed but never used): low-light +10 Moody / +8 Noir; colourful scene +8 Vivid / +6 Sunset; bright scene +8 Arctic / +6 Soft Fade. Small bonuses only — they break near-ties, never overturn a strong signal mismatch.
- `cool-mist` reason is now signal-conditional (was a static string that ignored the measurements).
- KNOWN OPEN QUESTION (not rewritten without human evidence): Golden Hour wins 8/24 and Warm Glow / Golden Hour / Sunset are three warm filters with overlapping triggers, so the top 3 can be all-warm. Whether that is wrong is exactly what the blind test decides — see the disagreement table it produces.
- Rosé is flagged in FILTER_LIBRARY.md: the app cannot detect skin or faces, so its condition is a heuristic only.

## Results

| Photo | Category | Bright | Warm | Sat | Contrast | Dominant | Subject | Top pick (score) | Why (signals) | Ranked alternatives |
|---|---|---|---|---|---|---|---|---|---|---|
| portrait-01 | portrait | 0.64 | 0.04 | 0.18 | 0.65 | warm-red | general photo | **Noir 70%** | Strong contrast + red-dominant — Noir fits best. | Soft Fade 70%, Golden Hour 67% |
| portrait-02 | portrait | 0.37 | -0.06 | 0.25 | 0.27 | blue | general photo | **Moody 79%** | Blue-dominant — Moody fits best. | Soft Fade 65%, Warm Glow 61% |
| portrait-03 | portrait | 0.61 | 0.11 | 0.19 | 0.49 | warm-red | general photo | **Golden Hour 70%** | Red-dominant + warm tones — Golden Hour fits best. | Soft Fade 70%, Noir 67% |
| landscape-01 | landscape | 0.74 | -0.02 | 0.12 | 0.51 | blue | general photo | **Noir 71%** | Strong contrast + blue-dominant — Noir fits best. | Arctic 71%, Soft Fade 70% |
| landscape-02 | landscape | 0.43 | 0.14 | 0.44 | 0.52 | warm-red | general photo | **Warm Glow 74%** | Strong contrast + red-dominant — Warm Glow fits best. | Golden Hour 71%, Vivid 66% |
| landscape-03 | landscape | 0.65 | -0.03 | 0.19 | 0.51 | blue | general photo | **Soft Fade 70%** | Strong contrast + blue-dominant — Soft Fade fits best. | Noir 67%, Golden Hour 64% |
| food-01 | food | 0.70 | 0.27 | 0.33 | 0.49 | warm-red | general photo | **Golden Hour 77%** | Red-dominant + warm tones — Golden Hour fits best. | Rosé 75%, Soft Fade 70% |
| food-02 | food | 0.56 | 0.22 | 0.39 | 0.42 | warm-red | general photo | **Golden Hour 75%** | Red-dominant + warm tones — Golden Hour fits best. | Rosé 75%, Sunset 69% |
| food-03 | food | 0.44 | 0.18 | 0.41 | 0.46 | warm-red | general photo | **Warm Glow 76%** | Red-dominant + warm tones — Warm Glow fits best. | Rosé 75%, Golden Hour 73% |
| pet-01 | pet | 0.41 | -0.10 | 0.27 | 0.07 | green | general photo | **Emerald 85%** | Soft contrast + green-dominant — Emerald fits best. | Soft Fade 65%, Golden Hour 61% |
| pet-02 | pet | 0.93 | -0.07 | 0.08 | 0.16 | blue | bright scene | **Soft Fade 91%** | Very bright + blue-dominant — Soft Fade fits best. | Arctic 81%, Noir 69% |
| pet-03 | pet | 0.43 | 0.00 | 0.52 | 0.41 | green | colourful scene | **Emerald 85%** | Rich colour + green-dominant — Emerald fits best. | Vivid 78%, Sunset 67% |
| low-light-01 | low-light | 0.24 | 0.11 | 0.42 | 0.48 | warm-red | low-light | **Moody 92%** | Low-light shot + red-dominant — Moody fits best. | Warm Glow 72%, Noir 65% |
| low-light-02 | low-light | 0.33 | -0.14 | 0.39 | 0.45 | blue | general photo | **Moody 82%** | Blue-dominant + cool tones — Moody fits best. | Vivid 62%, Emerald 60% |
| low-light-03 | low-light | 0.22 | 0.06 | 0.35 | 0.35 | warm-red | low-light | **Moody 90%** | Low-light shot + red-dominant — Moody fits best. | Warm Glow 69%, Soft Fade 65% |
| sunset-01 | sunset | 0.43 | 0.06 | 0.24 | 0.60 | warm-red | general photo | **Warm Glow 69%** | Strong contrast + red-dominant — Warm Glow fits best. | Golden Hour 68%, Noir 66% |
| sunset-02 | sunset | 0.53 | -0.09 | 0.37 | 0.49 | blue | general photo | **Vivid 64%** | Blue-dominant + cool tones — Vivid fits best. | Golden Hour 61%, Rosé 60% |
| sunset-03 | sunset | 0.47 | 0.30 | 0.44 | 0.41 | warm-red | general photo | **Golden Hour 79%** | Warm tones + red-dominant — Golden Hour fits best. | Rosé 75%, Sunset 74% |
| backlit-01 | backlit | 0.56 | 0.24 | 0.43 | 0.53 | warm-red | general photo | **Golden Hour 76%** | Strong contrast + red-dominant — Golden Hour fits best. | Rosé 75%, Sunset 71% |
| backlit-02 | backlit | 0.61 | 0.21 | 0.33 | 0.53 | warm-red | general photo | **Golden Hour 75%** | Strong contrast + red-dominant — Golden Hour fits best. | Rosé 75%, Soft Fade 70% |
| backlit-03 | backlit | 0.57 | 0.04 | 0.11 | 0.50 | warm-red | general photo | **Noir 72%** | Strong contrast + red-dominant — Noir fits best. | Golden Hour 67%, Rosé 60% |
| flat-daylight-01 | flat-daylight | 0.58 | 0.07 | 0.28 | 0.57 | warm-red | general photo | **Golden Hour 68%** | Strong contrast + red-dominant — Golden Hour fits best. | Noir 63%, Vivid 60% |
| flat-daylight-02 | flat-daylight | 0.66 | 0.03 | 0.12 | 0.34 | warm-red | general photo | **Soft Fade 85%** | Red-dominant + muted colour — Soft Fade fits best. | Noir 69%, Arctic 69% |
| flat-daylight-03 | flat-daylight | 0.56 | 0.07 | 0.18 | 0.41 | warm-red | general photo | **Golden Hour 68%** | Red-dominant — Golden Hour fits best. | Noir 67%, Rosé 60% |

## Signals that fired (for the rule rewrite)

- portrait-01 (portrait): strong contrast, red-dominant
- portrait-02 (portrait): blue-dominant
- portrait-03 (portrait): red-dominant, warm tones
- landscape-01 (landscape): strong contrast, blue-dominant, muted colour
- landscape-02 (landscape): strong contrast, red-dominant, warm tones
- landscape-03 (landscape): strong contrast, blue-dominant
- food-01 (food): red-dominant, warm tones
- food-02 (food): red-dominant, warm tones
- food-03 (food): red-dominant, warm tones
- pet-01 (pet): soft contrast, green-dominant, cool tones
- pet-02 (pet): very bright, blue-dominant, muted colour, soft contrast
- pet-03 (pet): rich colour, green-dominant
- low-light-01 (low-light): low-light shot, red-dominant, low light, warm tones
- low-light-02 (low-light): blue-dominant, cool tones
- low-light-03 (low-light): low-light shot, red-dominant, low light
- sunset-01 (sunset): strong contrast, red-dominant
- sunset-02 (sunset): blue-dominant, cool tones
- sunset-03 (sunset): warm tones, red-dominant
- backlit-01 (backlit): strong contrast, red-dominant, warm tones
- backlit-02 (backlit): strong contrast, red-dominant, warm tones
- backlit-03 (backlit): strong contrast, red-dominant, muted colour
- flat-daylight-01 (flat-daylight): strong contrast, red-dominant
- flat-daylight-02 (flat-daylight): red-dominant, muted colour
- flat-daylight-03 (flat-daylight): red-dominant

## Top-pick distribution

- golden-hour: 8/24 top picks
- moody: 4/24 top picks
- noir: 3/24 top picks
- warm-glow: 3/24 top picks
- soft-fade: 3/24 top picks
- emerald: 2/24 top picks
- vivid: 1/24 top picks

## Test set

24 photos, 3 per category, listed in `tests/photos.json` with source and verified content per photo. 22 are picsum.photos seeds (Unsplash-sourced, free to use); the 2 food photos (pizza, burger) are generated — Wikimedia and Flickr block this machine's network range, so no openly licensed food photo could be downloaded. No personal photos are used.
