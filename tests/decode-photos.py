#!/usr/bin/env python3
"""Decode the 24 test photos to raw RGBA bytes for the Node harness.

The browser's analyzePhoto() downsamples to 64x64 with drawImage, then
averages the pixels. This script does the equivalent resize with PIL and
dumps the 64x64 RGBA bytes, so tests/run-recommendations.mjs can run the
REAL src/analyze.js code in Node with no browser.
"""
import json
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "photos-raw")
os.makedirs(OUT, exist_ok=True)

manifest = json.load(open(os.path.join(HERE, "photos.json")))
for entry in manifest:
    src = os.path.join(HERE, "photos", entry["file"])
    im = Image.open(src).convert("RGBA").resize((64, 64), Image.LANCZOS)
    raw = im.tobytes()
    assert len(raw) == 64 * 64 * 4, entry["file"]
    open(os.path.join(OUT, entry["file"] + ".rgba"), "wb").write(raw)
    print(entry["id"], entry["category"], "->", entry["file"] + ".rgba")

print(f"decoded {len(manifest)} photos to {OUT}")
