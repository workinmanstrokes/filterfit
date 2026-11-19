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
- Live preview grid showing the photo under every filter
- Intensity slider and hold-to-compare before/after view for the chosen filter
- Fine-tune brightness, contrast, warmth and saturation after applying a filter
- Export the edited photo at full resolution and share it via the native share sheet
- Local history of analysed photos and their recommended filters

## Screens

Home / Import · Analysing · Recommendations · Filter Preview Grid · Editor ·
Before / After Compare · Export & Share · History

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

## Open questions

- Should recommendations use simple on-device heuristics, or a trained ML model
  / cloud AI service?
- Should the app keep an in-app library of edited photos, or only export to the
  camera roll?
- Are all filters free in v1, or is there a premium filter pack?

## Tech

Capacitor + Vite + vanilla JavaScript + Tailwind CSS.
