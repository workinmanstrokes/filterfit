# FilterFit

**Upload a photo, get its perfect filter.**

FilterFit is a polished cross-platform iOS and Android app that analyses a photo
on-device — brightness, colour, warmth and subject — and recommends the filter
that suits it best, with ranked alternatives, live previews, intensity and
fine-tune controls, and full-resolution export.

## Features

- Import a photo from the camera or photo library
- On-device analysis of brightness, contrast, warmth, saturation, dominant
  colours and subject type
- Ranked top-3 filter recommendations with a match score and a plain-language reason
- A one-line, signal-based reason for the top pick ("Warm tones + low light")
- Hold-to-compare before/after view (press and hold the photo) on the
  recommendations preview and in the editor
- Intensity slider and fine-tune brightness, contrast, warmth and saturation
  after applying a filter
- Save a tuned result as a reusable preset and re-apply it in one tap
- Recent photos strip with thumbnails — tap one to reopen it
- A locked filter library of 12 filters, each with its photo condition and
  default intensity (`FILTER_LIBRARY.md`)
- Export the edited photo at full resolution and share it via the native share sheet
- Local history of analysed photos and their recommended filters
- Performance diagnostics behind `?perf=1` (analysis / preview / export timings)

## The filter library

12 filters, frozen — see [`FILTER_LIBRARY.md`](FILTER_LIBRARY.md). Each filter
names the photo condition it is for and its default intensity, and the app
reads both from `src/filters.js`, so the doc, the code, and the in-app library
list (home screen) cannot drift. No new filters until the current set wins the
blind test in `tests/`.

## Proving the recommendation (`tests/`)

- A fixed 24-photo test set (portrait, landscape, food, pet, low-light,
  sunset, backlit, flat daylight — 3 each) with sources recorded in
  `tests/photos.json`.
- `node tests/run-recommendations.mjs` runs the real scoring code over the set
  and writes `tests/recommendation-baseline.md` — the app's pick before any
  human test.
- `tests/blind-pick.html` is the blind test: three people pick their favourite
  look per photo with the app's pick hidden. `node tests/compare-picks.mjs`
  compares their picks against the baseline. See `tests/README.md`.
- Rule fixes already made from the baseline: saturation is measured per-pixel
  (the old channel-means version washed colour out and made Noir win 21 of 24
  photos); Noir earns its bonus only below 0.35 saturation; Rosé needs real
  warmth as well as a red-dominant cast; `subject` is wired in as a small
  tie-breaker. The warm-filter cluster is deliberately left for the blind test
  to judge.

## Performance

The old editor re-rendered the full-resolution photo on every slider movement
(~190 ms per movement on a 12 MP photo, measured headlessly in
`tests/perf-probe.mjs`). Live previews now render at 1024 px on the long side
(~14 ms) and at most once per animation frame; export still renders at full
resolution. Real-phone numbers come from the in-app diagnostics — see
[`docs/perf-test-protocol.md`](docs/perf-test-protocol.md) for the two-phone
test (low-end Android + older iPhone).

## Store listing (draft)

[`docs/store-listing-draft.md`](docs/store-listing-draft.md) — title, short and
long descriptions, keywords, and the monetisation options with a
recommendation. The price is NOT decided; that is Mike's call.

## Screens

Home / Import · Analysing · Recommendations · Editor · Before / After Compare ·
Export & Share · History · Presets · Filter Library · Diagnostics (`?perf=1`)

## How to run

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production web build into dist/
```

## iOS / Android builds (Capacitor)

```bash
npx cap add ios
npx cap add android
npm run build
npx cap sync
npx cap open ios       # Xcode
npx cap open android   # Android Studio
```

The app is a single JavaScript codebase (Capacitor + Vite + vanilla JS +
Tailwind CSS). Canvas handles on-device photo analysis and filtering — no
server and no ML backend are required.

## Build milestones

1. Capacitor app shell with photo import and full-screen display
2. Filter engine with 12 canvas filters, intensity slider and before/after compare
3. On-device photo analyser and heuristic scoring that ranks filters for each photo
4. Recommendations screen and editor UI with top-3 cards, scores and reasons
5. Full-resolution export, native sharing and locally stored history
6. Premium dark UI polish, real-device testing on iPhone and Android, and
   store-ready builds
7. Presets (save a tuned look, re-apply in one tap) and recent photos with
   thumbnails; filter library locked at 12 with conditions and defaults
8. Explainable picks (signal-based one-line reason) and hold-to-compare on
   both previews; live preview capped at 1024 px + rAF throttle, with an
   in-app perf diagnostics mode
9. Fixed 24-photo test set, Node recommendation baseline, and a blind-pick
   page + comparison script for the 3-person human test

## Open questions

- Should recommendations use simple on-device heuristics, or a trained ML model
  / cloud AI service?
- Monetisation: see `docs/store-listing-draft.md` — recommendation is free,
  no ads, with a one-off preset/filter pack later. The price is Mike's call.
- Should the app keep an in-app library of edited photos, or only export to the
  camera roll? (Answered for now: recents are stored locally at up to 1024 px
  and can be reopened; full-res originals live in the camera roll.)

## Tech

Capacitor + Vite + vanilla JavaScript + Tailwind CSS.

