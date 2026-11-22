#!/usr/bin/env node
// A 12000×9000 JPEG is ~400MB once decoded (a 50–200MP camera frame).
// Feeding it through the real file input must show recommendations without a
// main-thread task long enough for Android to report "Chrome isn't responding".
//
// Usage: node tests/responsive-photo.mjs <baseUrl>
//   Needs Playwright's Chromium (see .github/workflows/layout-check.yml).
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeBlockJpeg } from './make-jpeg.mjs';

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('Usage: node tests/responsive-photo.mjs <baseUrl>');
  process.exit(1);
}

const LONG_TASK_MS = 1000;
const dir = mkdtempSync(path.join(tmpdir(), 'filterfit-large-'));
const jpegPath = path.join(dir, 'camera-12000x9000.jpg');
// 108 megapixels. The file itself stays small because each block is flat;
// a full decode would still allocate width×height×4 bytes.
const jpeg = makeBlockJpeg(12000, 9000, { padBytes: 2 * 1024 * 1024 });
writeFileSync(jpegPath, jpeg);
console.log(`fixture ${jpeg.length} bytes, frame 12000x9000`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const capture = await page.getAttribute('#cameraInput', 'capture');
  const accept = await page.getAttribute('#fileInput', 'accept');
  if (capture !== 'environment' || !String(accept).includes('image')) {
    throw new Error(`file inputs are wrong: capture=${capture} accept=${accept}`);
  }
  await page.evaluate(() => {
    window.__longTasks = [];
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch (err) {
      window.__longTaskError = String(err);
    }
    window.__maxLag = 0;
    window.__dataUrls = 0;
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      window.__maxLag = Math.max(window.__maxLag, now - last);
      last = now;
    }, 50);
    const proto = FileReader.prototype;
    const orig = proto.readAsDataURL;
    proto.readAsDataURL = function readAsDataURLSpy(...args) {
      window.__dataUrls += 1;
      return orig.apply(this, args);
    };
  });
  await page.setInputFiles('#fileInput', jpegPath);
  await page.waitForSelector('#screen-recommendations:not(.hidden)', { timeout: 20000 });
  // One more beat so a task that started as results appeared is counted.
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => ({
    tasks: window.__longTasks || [],
    longTaskError: window.__longTaskError || '',
    maxLag: window.__maxLag,
    dataUrls: window.__dataUrls,
    why: document.getElementById('whyPick')?.textContent || '',
    error: document.getElementById('photoError')?.textContent || '',
    homeHidden: document.getElementById('screen-home')?.classList.contains('hidden'),
  }));
  const maxTask = info.tasks.reduce((m, n) => Math.max(m, n), 0);
  console.log(JSON.stringify({
    maxTask: Math.round(maxTask),
    tasks: info.tasks.map((n) => Math.round(n)),
    maxLag: Math.round(info.maxLag),
    dataUrls: info.dataUrls,
    why: info.why,
    error: info.error,
    pageErrors,
    longTaskError: info.longTaskError,
  }, null, 2));
  const problems = [];
  if (!info.homeHidden) problems.push('recommendations screen did not replace home');
  if (info.why.length < 5) problems.push(`missing why-line: ${info.why}`);
  if (info.error) problems.push(`photo error: ${info.error}`);
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
  if (info.dataUrls > 0) problems.push(`readAsDataURL was used ${info.dataUrls} time(s)`);
  if (maxTask > LONG_TASK_MS) problems.push(`long task ${Math.round(maxTask)}ms`);
  if (info.maxLag > LONG_TASK_MS) problems.push(`main thread lagged ${Math.round(info.maxLag)}ms`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('responsive-photo: passed');
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(process.exitCode || 0);
