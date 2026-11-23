# FilterFit subject analysis — what it is, and what it is not

FilterFit analyses light and colour, not subjects. This file says exactly
what the `subject` label in `src/analyze.js` is, how it is computed, what
happens when it cannot tell, and what would have to change for real subject
detection. It exists because the Lab tester's weakness #8 was fair: the
subject analysis was a black box.

## The four subjects

`analyzePixels()` assigns exactly one of four labels, checked in this order:

| Subject | Rule (on the 64×64 downsampled pixels) |
|---|---|
| `low-light` | brightness < 0.25 |
| `colourful scene` | saturation > 0.45 |
| `bright scene` | brightness > 0.8 |
| `general photo` | none of the above — the fallback |

Brightness is the mean pixel luminance / 255. Saturation is the mean
per-pixel saturation (max − min channel / max channel, averaged over pixels —
not computed from the channel means, which washed colour out; see the comment
in `src/analyze.js`).

## Detection method

There is no face, skin, object or scene detection. There is no ML model and
no server call. The image is downsampled to a 64×64 canvas, its pixels are
measured for brightness, contrast, warmth, saturation and dominant colour,
and the subject label is read straight off the brightness and saturation
numbers. It is a proxy, not a detection — the code says so in its own
comment, and `FILTER_LIBRARY.md` says so too.

## Fallback, and how much the label matters

- If no threshold fires, the subject is `general photo`. That label earns no
  bonus for any filter — it is the neutral fallback.
- The subject is only a small tie-breaker in `scoreFilter()` (at most +10:
  low-light → Moody +10, Noir +8; colourful scene → Vivid +8, Sunset +6;
  bright scene → Arctic +8, Soft Fade +6). It can never overturn a strong
  brightness/colour/warmth mismatch; it only breaks near-ties.
- The one-line reason shown in the app (`explainPick()`) is built from the
  measured signals (warmth, brightness, saturation, contrast, dominant
  colour), not from the subject label — the subject contributes only the
  `low-light shot` signal.

## Edge cases, honestly stated

- The app cannot tell a portrait from a landscape, a person from a pet, or
  food from a building. Two photos with the same brightness and saturation
  get the same subject label even if the subjects differ.
- A photo that is both dark and colourful is labelled `low-light`
  (brightness is checked first); its saturation still feeds the Vivid and
  Sunset scores directly.
- A backlit photo — bright background, dark subject — averages out to
  mid-brightness, so the label is usually `general photo`; the
  strong-contrast signal is what the scoring actually responds to.
- Rosé's "portraits" condition is a guess from a warm-red colour cast, not a
  detection. It is flagged heuristic-only in `FILTER_LIBRARY.md` — treat it
  as a manual pick, not a recommendation to trust blindly.
- The 24-photo test set (`tests/`) covers portrait, landscape, food, pet,
  low-light, sunset, backlit and flat daylight, so these edge cases are
  exercised by the blind test even though the app cannot name them.

## What would change this

Real subject detection would need an on-device model (for example a small
segmentation or classification model shipped with the app) or a cloud
service. Both are out of scope for the current plan — on-device heuristics
only, no server, no ML backend — so until that changes, the honest statement
stands: FilterFit measures light and colour, and the subject label is a
small tie-breaker, not a detection.
