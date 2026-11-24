# FilterFit

**Upload a photo, get its perfect filter.**

FilterFit is a polished cross-platform iOS and Android app that analyses a photo
on-device — brightness, colour, warmth and subject — and recommends the filter
that suits it best, with ranked alternatives, live previews, intensity and
fine-tune controls, and full-resolution export.

## Features

- Import a photo from the camera or photo library
- On-device analysis of brightness, contrast, warmth, saturation, dominant
  colours and subject type — how the subject label works, and its limits, is
  in [`docs/subject-analysis.md`](docs/subject-analysis.md)
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

## UI & layout

- Dark, premium photo-app styling (Tailwind). Home is the import screen;
  recommendations show the top-3 cards with match scores and the one-line
  reason; the editor has the intensity slider, fine-tune controls and the
  filter grid; history and presets live on the home screen.
- Every photo preview is shown at most 1024 px on the long side and never
  wider than the screen, with safe-area padding — the app fits the phone
  with no zooming or sideways scrolling. That is checked in CI at 412×915,
  360×780 and 915×412, and landscape gets a two-column recommendations /
  editor layout.
- Hold-to-compare: press and hold the photo on the recommendations preview
  or in the editor to see the unfiltered original; release to return to the
  filtered version.
- Filter look: 12 canvas filters (see `FILTER_LIBRARY.md`). The preview grid
  shows the photo under every filter at thumbnail size; tapping one applies
  it at its default intensity, and the slider then adjusts it for that photo
  only.

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
- The recommendations screen shows the measured signals behind the pick
  (brightness, warmth, saturation, contrast, dominant colour, strongest
  signals) under the one-line reason, so a pick can be checked against what
  was actually measured instead of feeling random. The scoring rules and
  thresholds are in `src/analyze.js` (`scoreFilter`, `describeSignals`).
- "Was this pick right?" on the recommendations screen stores the verdict
  on-device (localStorage `filterfit.pick-feedback.v1`, latest 50) — a "No"
  records whichever filter is selected as the user's pick, so disagreements
  accumulate as real data for the next rule rewrite. That is not the blind
  test: the 3-person blind test below is still the deciding validation.
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

## Still needs a person (not code)

These Lab items cannot be closed by a commit — they need Mike or three real
people:

- **3-person blind test** — run `tests/blind-pick.html` with three people;
  `node tests/compare-picks.mjs` then writes `tests/blind-comparison.md`,
  and the rule rewrite starts from its disagreement table. Until then the
  warm-filter overlap (Golden Hour / Warm Glow / Sunset) stays as it is.
- **Real-device perf numbers** — run
  [`docs/perf-test-protocol.md`](docs/perf-test-protocol.md) on a low-end
  Android and an older iPhone and send the diagnostics JSON back. Headless
  numbers so far: analysis ~1 ms, preview ~14 ms at 1024 px (was ~190 ms
  full-res per slider move), export at full resolution once per export.
- **Monetisation decision** — the draft and recommendation (free, no ads,
  with a one-off preset/filter pack later) are in
  [`docs/store-listing-draft.md`](docs/store-listing-draft.md); the price is
  Mike's call.
- **Store screenshots** — the five shots listed in the store draft, taken
  once the blind test and perf runs are done.

## Screens

Home / Import · Analysing · Recommendations · Editor · Before / After Compare ·
Export & Share · History · Presets · Filter Library · Diagnostics (`?perf=1`)

## How to run

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production web build into dist/
```

## Native builds (Android APK + iOS)

The native platform folders (`android/`, `ios/`) are **generated, not committed**
— they are built fresh in CI from this repo (see `.gitignore`). The workflows
live in `.github/workflows/`:

- **`build-android.yml`** — on every push to `main` (and manual dispatch):
  checks out the repo, sets up Node + JDK 17 + the Android SDK, runs
  `npm ci`, `npm run build`, `npx cap add android`, `npx cap sync android`,
  then builds the debug APK with Gradle and uploads it as the
  `filterfit-debug-apk` artifact. Download it from the workflow run's
  Artifacts section, then sideload it on an Android phone: transfer the
  `.apk` to the phone, tap it, allow "Install unknown apps" for the app
  that opens it, and install. No Play Store account or signing key is needed
  for a debug APK.
- **`build-ios.yml`** — macOS runner, same web build, `npx cap add ios`,
  `npx cap sync ios`, then `xcodebuild` builds the app **without signing**
  (`CODE_SIGNING_ALLOWED=NO`) and uploads the unsigned `.app` as an
  artifact. This proves the native iOS project builds.

**iOS signing — read this before expecting an iPhone install:** an unsigned
iOS build **cannot be installed on a real iPhone**. Installing on an iPhone
needs an Apple Developer account ($99/year) plus a signing certificate and a
provisioning profile, and distribution through Xcode or TestFlight. Until
that exists, the iPhone options are the web app or Add to Home Screen from
Safari (not a native install, but the same app in full screen).

Local commands (same as CI, minus the SDK signing):

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
10. In-app evidence for the pick (measured signals shown on the
    recommendations screen) and pick feedback recorded locally; the 3-person
    blind test remains the deciding validation (human step, still pending)

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
