#!/usr/bin/env node
// Samsung S25 Ultra path: Android Chrome, 6x CPU, a tight JS heap, and a
// real-size camera JPEG (16320×12240, EXIF orientation 6, 4:2:0, APP2/MPF,
// about 15–40MB). The whole flow after capture has to stay responsive:
// analysis, recommendations, every filter thumbnail, the editor, history.
//
// A worker failure must show an error. The old code decoded that file on the
// main thread instead, which is the freeze.
//
// Usage: node tests/android-photo-flow.mjs <baseUrl>
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeSamsungJpeg } from './make-jpeg.mjs';

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('Usage: node tests/android-photo-flow.mjs <baseUrl>');
  process.exit(1);
}

const LONG_TASK_MS = 1000;
const HEAP_LIMIT = 220 * 1024 * 1024;
const dir = mkdtempSync(path.join(tmpdir(), 'filterfit-android-'));

function writePhoto(name, width, height, padBytes) {
  const started = performance.now();
  const bytes = makeSamsungJpeg(width, height, { acCount: 2, padBytes });
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  console.log(`${name}: ${(bytes.length / 1048576).toFixed(1)}MB in ${(performance.now() - started).toFixed(0)}ms`);
  return file;
}

const photo12 = writePhoto('twelve.jpg', 4000, 3000, 2 * 1024 * 1024);
const photo200 = writePhoto('samsung-200mp.jpg', 16320, 12240, 14 * 1024 * 1024);

const browser = await chromium.launch({
  args: [
    '--js-flags=--max-old-space-size=256',
    '--disable-dev-shm-usage',
  ],
});

async function instrument(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.evaluate(() => {
    window.__longTasks = [];
    window.__maxLag = 0;
    window.__heapPeak = 0;
    window.__dataUrls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
      }).observe({ entryTypes: ['longtask'] });
    } catch (err) {
      window.__longTaskError = String(err);
    }
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      window.__maxLag = Math.max(window.__maxLag, now - last);
      last = now;
      const heap = performance.memory && performance.memory.usedJSHeapSize;
      if (heap) window.__heapPeak = Math.max(window.__heapPeak, heap);
    }, 50);
    const orig = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function spy(...args) {
      window.__dataUrls += 1;
      return orig.apply(this, args);
    };
  });
}

async function readProbe(page) {
  return page.evaluate(() => ({
    tasks: window.__longTasks || [],
    maxLag: window.__maxLag || 0,
    heapPeak: window.__heapPeak || 0,
    dataUrls: window.__dataUrls || 0,
    longTaskError: window.__longTaskError || '',
    why: document.getElementById('whyPick')?.textContent || '',
    error: document.getElementById('photoError')?.textContent || '',
    preview: Math.max(
      document.getElementById('previewCanvas')?.width || 0,
      document.getElementById('previewCanvas')?.height || 0,
    ),
    editor: Math.max(
      document.getElementById('editorCanvas')?.width || 0,
      document.getElementById('editorCanvas')?.height || 0,
    ),
    thumbs: [...document.querySelectorAll('.filter-thumb')].map((canvas) => Math.max(canvas.width, canvas.height)),
    homeHidden: document.getElementById('screen-home')?.classList.contains('hidden'),
    editorVisible: !document.getElementById('screen-editor')?.classList.contains('hidden'),
  }));
}

function problemsFrom(info, label) {
  const problems = [];
  const maxTask = info.tasks.reduce((max, value) => Math.max(max, value), 0);
  if (maxTask > LONG_TASK_MS) problems.push(`${label}: long task ${maxTask}ms (${info.tasks.join(', ')})`);
  if (info.maxLag > LONG_TASK_MS) problems.push(`${label}: main-thread gap ${Math.round(info.maxLag)}ms`);
  if (info.heapPeak > HEAP_LIMIT) problems.push(`${label}: heap peaked at ${Math.round(info.heapPeak / 1048576)}MB`);
  if (info.dataUrls > 0) problems.push(`${label}: readAsDataURL ran ${info.dataUrls} time(s)`);
  return problems;
}

const problems = [];
try {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await instrument(page);

  async function runFlow(file, label) {
    await page.click('#backHomeBtn').catch(() => {});
    await page.evaluate(() => {
      window.__longTasks = [];
      window.__maxLag = 0;
    });
    await page.setInputFiles('#fileInput', file);
    await page.waitForSelector('#screen-recommendations:not(.hidden)', { timeout: 25000 });
    if ((await page.textContent('#whyPick') || '').length < 5) problems.push(`${label}: missing recommendation`);
    await page.click('#openEditorBtn');
    await page.waitForSelector('#screen-editor:not(.hidden)');
    const chips = page.locator('#filterGrid .filter-chip');
    const count = await chips.count();
    if (count !== 12) problems.push(`${label}: expected 12 filter thumbnails, saw ${count}`);
    for (let i = 0; i < count; i++) await chips.nth(i).click();
    const download = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await page.click('#exportBtn');
    await download;
    await page.waitForFunction(() => {
      try {
        const history = JSON.parse(localStorage.getItem('filterfit.history.v1') || '[]');
        return history[0] && history[0].thumb && history[0].image && history[0].image.length < 180000;
      } catch {
        return false;
      }
    }, { timeout: 10000 });
    await page.click('#backHomeBtn');
    await page.waitForSelector('#screen-home:not(.hidden)');
    const info = await readProbe(page);
    console.log(label, JSON.stringify({
      tasks: info.tasks,
      maxLag: Math.round(info.maxLag),
      heapMB: Math.round(info.heapPeak / 1048576),
      preview: info.preview,
      editor: info.editor,
      thumbs: info.thumbs,
      dataUrls: info.dataUrls,
      why: info.why,
    }));
    if (info.preview > 1600) problems.push(`${label}: preview canvas ${info.preview}px`);
    if (info.editor > 1600) problems.push(`${label}: editor canvas ${info.editor}px`);
    if (!info.thumbs.length || info.thumbs.some((edge) => edge > 256 || edge < 2)) {
      problems.push(`${label}: thumb edges ${info.thumbs.join(',')} are not capped at 256`);
    }
    problems.push(...problemsFrom(info, label));
  }

  await runFlow(photo12, '12MP');
  await runFlow(photo200, '200MP');

  // Worker script blocked: the page must show an error and stay responsive,
  // not Huffman-decode the camera file on the main thread.
  await page.route('**/*jpeg-worker*', (route) => route.abort());
  await page.evaluate(() => { window.__longTasks = []; window.__maxLag = 0; });
  await page.setInputFiles('#fileInput', photo200);
  await page.waitForFunction(() => {
    const el = document.getElementById('photoError');
    return el && !el.classList.contains('hidden') && el.textContent.length > 10;
  }, { timeout: 10000 });
  const refused = await readProbe(page);
  console.log('worker-blocked', JSON.stringify({
    tasks: refused.tasks,
    maxLag: Math.round(refused.maxLag),
    error: refused.error,
    homeHidden: refused.homeHidden,
  }));
  if (refused.homeHidden) problems.push('worker failure left the analysing screen up');
  if (!/couldn.?t open|too long/i.test(refused.error)) problems.push(`worker failure message: ${refused.error}`);
  problems.push(...problemsFrom(refused, 'worker-blocked'));
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
  await context.close();
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('android-photo-flow: passed');
