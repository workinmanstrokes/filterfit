#!/usr/bin/env node
// Phone layout check: opens the built app in a mobile Chromium (touch, real
// viewport-meta handling) at phone sizes, walks home -> recommendations ->
// editor with a real test photo, and checks that nothing is wider than the
// screen and the page never has to be zoomed out to fit. Saves a screenshot
// of every screen at every size.
//
// Usage: node tests/layout-check.mjs <baseUrl> <outDir> [--no-fail]
//   (needs `playwright` installed and Chromium downloaded; see
//   .github/workflows/layout-check.yml)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [baseUrl = 'http://localhost:4173/', outDir = 'layout-shots'] = process.argv.slice(2);
const noFail = process.argv.includes('--no-fail');
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: 'portrait-412x915', width: 412, height: 915 }, // Galaxy S25 Ultra
  { name: 'portrait-360x780', width: 360, height: 780 }, // small Android phone
  { name: 'landscape-915x412', width: 915, height: 412 }, // S25 Ultra sideways
];
const PHOTOS = ['beach1.jpg', 'portrait1.jpg'];

// Everything that sticks out past the right edge of the screen, ignoring
// content inside containers that are meant to scroll sideways on their own.
async function measure(page, vw) {
  return page.evaluate((vw) => {
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      let p = el.parentElement, inScroller = false;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { inScroller = true; break; }
        p = p.parentElement;
      }
      if (inScroller) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} (${Math.round(r.left)}..${Math.round(r.right)}px)`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      layoutWidth: window.innerWidth,
      zoom: window.visualViewport ? +window.visualViewport.scale.toFixed(3) : 1,
      offenders: offenders.slice(0, 8),
    };
  }, vw);
}

const browser = await chromium.launch();
const results = [];
let failed = false;

for (const vp of VIEWPORTS) {
  for (const photo of PHOTOS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    const shots = [];
    const check = async (screen) => {
      await page.waitForTimeout(300);
      const m = await measure(page, vp.width);
      const ok = m.offenders.length === 0 && m.zoom >= 0.99 && m.layoutWidth <= vp.width;
      if (!ok) failed = true;
      const file = `${vp.name}-${path.parse(photo).name}-${screen}.png`;
      await page.screenshot({ path: path.join(outDir, file), fullPage: false });
      shots.push(file);
      results.push({ viewport: vp.name, photo, screen, ok, ...m });
    };

    if (photo === PHOTOS[0]) await check('home');
    await page.setInputFiles('#fileInput', path.join(HERE, 'photos', photo));
    await page.waitForSelector('#screen-recommendations:not(.hidden)', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
    await check('recommendations');
    await page.click('#openEditorBtn').catch(() => {});
    await check('editor');
    await context.close();
  }
}
await browser.close();

const lines = ['| Size | Photo | Screen | Fits | Zoom | Layout width | Sticking out |', '|---|---|---|---|---|---|---|'];
for (const r of results) {
  lines.push(`| ${r.viewport} | ${r.photo} | ${r.screen} | ${r.ok ? 'yes' : '**NO**'} | ${r.zoom} | ${r.layoutWidth}px | ${r.offenders.join(', ') || '-'} |`);
}
const report = lines.join('\n');
writeFileSync(path.join(outDir, 'report.md'), report + '\n');
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
console.log(report);
if (failed && !noFail) {
  console.error('\nLayout check failed: something is wider than the phone screen or the page had to zoom out.');
  process.exit(1);
}
