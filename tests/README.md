# FilterFit tests — 24-photo recommendation test

This folder proves (or disproves) the app's core claim: that its top filter pick
is usually the right one. It does not contain any human picks — those come only
from real people doing the blind test below.

## The test set (`photos.json` + `photos/`)

24 photos, 3 per category: portrait, landscape, food, pet, low-light, sunset,
backlit, flat daylight. Every photo's source and verified content is recorded
in `photos.json`.

- 22 photos are `picsum.photos` seeds (Unsplash-sourced, free to use). Seed names
  do NOT describe the content — each photo was looked at and categorised by
  what it actually shows.
- 2 food photos (pizza, burger) are generated. Wikimedia and Flickr both block
  this machine's network range, so no openly licensed food photo could be
  downloaded; the generated files are labelled as such in `photos.json`.
- No personal photos are used anywhere in the set.

## 1. The app's baseline (`recommendation-baseline.md`)

Run the real scoring code over all 24 photos:

```bash
python3 tests/decode-photos.py   # decode photos to raw RGBA (PIL)
node tests/run-recommendations.mjs
```

This writes `recommendation-baseline.md` (human-readable table: signals, top
pick, ranked alternatives per photo) and `baseline-results.json`
(machine-readable, for the comparison step). Re-run it after any rule change —
the baseline is the reference the blind test measures against.

Rule changes already made from the baseline (all documented in the baseline
file): saturation is now measured per-pixel; Noir earns its bonus only below
0.35 saturation; Rosé needs real warmth as well as a red-dominant cast;
`subject` is wired in as a small tie-breaker; the `cool-mist` reason is
signal-conditional. The warm-filter cluster (Golden Hour / Warm Glow / Sunset)
is deliberately NOT rewritten yet — the blind test decides whether it is wrong.

## 2. The blind test (`blind-pick.html`) — Mike's step

Serve the repo so the page can load its files, then open the page:

```bash
python3 -m http.server 8000
# open http://localhost:8000/tests/blind-pick.html
```

1. Three different people each do the test (it takes about 5 minutes each):
   type your name, tap your favourite look for each of the 24 photos.
2. The app's pick is never shown on the page, so nobody can be influenced by it.
3. At the end each person taps **Download my picks (JSON)** and sends you the file.
4. Send the three JSON files back here. No picks are invented or simulated —
   if a file is missing, that tester is excluded, not guessed.

## 3. The comparison (`compare-picks.mjs`)

```bash
node tests/compare-picks.mjs picks-alex.json picks-sam.json picks-jo.json
```

Writes `blind-comparison.md`: overall agreement, agreement per tester and per
category, and the disagreement table (app top pick vs the human majority).
The rule rewrite starts from that table: rewrite a rule only where the human
majority disagrees with the app on the same photo more than once in a
category — one disagreement is a taste difference, a pattern is a rule error.

## Files

- `photos.json` — the 24-photo manifest (id, category, file, source, verified content)
- `photos/` — the 24 test photos (800×600)
- `photos-raw/` — decoded 64×64 RGBA bytes (generated; do not hand-edit)
- `candidates/` — the 77 photos downloaded while picking the set (not part of the test)
- `decode-photos.py` — decodes photos for the Node harness
- `run-recommendations.mjs` — runs the real scoring code, writes the baseline
- `baseline-results.json` — machine-readable baseline
- `recommendation-baseline.md` — human-readable baseline
- `blind-pick.html` — the blind test page (no app pick shown)
- `compare-picks.mjs` — compares blind picks against the baseline
- `blind-comparison.md` — written by the comparison step (not yet run: no human picks yet)

## Phone layout check

`tests/layout-check.mjs` opens the built app in a mobile Chromium at 412x915,
360x780 and 915x412, walks home, recommendations and editor with real test
photos, and fails if anything is wider than the screen or the page has to
zoom out. It runs in CI (`.github/workflows/layout-check.yml`), which also
uploads before/after screenshots as the `filterfit-phone-screenshots`
artifact. Locally: `npm i --no-save playwright && npx playwright install chromium`,
`npm run build && npx vite preview`, then `node tests/layout-check.mjs http://localhost:4173/ layout-shots`.
