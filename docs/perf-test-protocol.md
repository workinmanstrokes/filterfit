# FilterFit performance test protocol — real phones

The in-app diagnostics (`?perf=1`) measure the real pipeline on the device
you run it on. Nothing in this protocol needs a computer: open the app on the
phone, tap through the steps, and send the numbers back.

## The two phones

1. **Low-end Android** — any older or budget Android Mike has (record the exact
   model + Android version from Settings → About phone).
2. **Older iPhone** — Mike's older iPhone (record the exact model + iOS version
   from Settings → General → About).

Use the same photo on both phones so the numbers are comparable: pick one
12 MP photo from the camera roll (a normal daylight photo, not a screenshot).

## Setup (once per phone)

1. Open FilterFit in the phone's browser at the dev/preview URL with `?perf=1`
   on the end (for example `http://…:8000/?perf=1`). A **Diagnostics** section
   appears on the home screen.
2. Load the same 12 MP test photo (tap Choose from library).

## Run 1 — the numbers (tap "Run diagnostics")

1. With the photo loaded, tap **Run diagnostics** and wait for the results.
2. Tap **Copy results JSON** and paste it into a message back here (or
   screenshot the results block).
3. Report: `analysis.medianMs`, `preview.medianMs`, `export.totalMs`,
   `export.bytes`, `export.width × height`, and `heapBeforeMB`/`heapAfterMB`
   (memory is reported as `null` on iPhones — Safari doesn't expose it, and
   the app does not guess it).

## Run 2 — slider lag (drag the intensity slider)

1. Open the editor, then drag the intensity slider slowly back and forth for
   about 10 seconds.
2. Go back home and tap **Run diagnostics** again — the results now include a
   `sliderLag` block (median / p95 frame time, and how many frames took over
   32 ms).
3. Report the `sliderLag` numbers, plus one line in plain words: did the
   preview feel smooth, or did it stutter while dragging?

## Run 3 — export (full resolution)

1. In the editor, tap **Export & share** and time it roughly (count seconds
   until the share sheet or download appears).
2. Report the rough seconds and whether the share sheet opened cleanly.

## What the numbers mean (so you know what you're sending)

- **Analysis ~1 ms** on a desktop (measured headlessly): the 64×64 analysis
  was never the slow step. If a phone reports far more, say so — that would
  be new information.
- **Preview render** is the step that was fixed: the old code re-rendered the
  full-resolution photo on every slider movement (~190 ms per movement on a
  12 MP photo, measured headlessly — 12× over the 16 ms a smooth frame
  allows). The new code previews at 1024 px on the long side (~14 ms
  headlessly) and renders at most once per animation frame.
- **Export** still renders at full resolution — that cost is paid once per
  export, not per slider movement. If export feels slow on the low-end
  Android, that is the next thing to fix (before any new feature).

## Send back

For each phone: model + OS version, the diagnostics JSON (or a screenshot of
it), the slider-lag numbers + smooth/stutter in your words, and the rough
export seconds. No other setup is needed.
