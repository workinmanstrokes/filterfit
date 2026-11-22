#!/usr/bin/env node
// The Capacitor 7 camera plugin decodes the full bitmap, then scales.
// scripts/patch-capacitor-camera.mjs must subsample first, including for a
// 200MP frame, and must be safe to run twice (npm ci postinstall).
//
// Usage: node tests/camera-subsample.mjs
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchSources, sampleSizeForDecode } from '../scripts/patch-capacitor-camera.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures.push(name);
}

function decodedLongEdge(width, height, sample) {
  return Math.max(Math.floor(width / sample), Math.floor(height / sample));
}

const twelve = sampleSizeForDecode(4000, 3000, 4096, 4096);
check('12MP (4000px) is not subsampled', twelve === 1 && decodedLongEdge(4000, 3000, twelve) === 4000);

const fifty = sampleSizeForDecode(8160, 6120, 4096, 4096);
check(
  '50MP decodes under the 4096 cap',
  fifty === 2 && decodedLongEdge(8160, 6120, fifty) <= 4096,
  `sample ${fifty}, long edge ${decodedLongEdge(8160, 6120, fifty)}`,
);

const twoHundred = sampleSizeForDecode(16320, 12240, 4096, 4096);
check(
  '200MP decodes under the 4096 cap (not the 2× overshoot)',
  twoHundred === 4 && decodedLongEdge(16320, 12240, twoHundred) <= 4096,
  `sample ${twoHundred}, long edge ${decodedLongEdge(16320, 12240, twoHundred)}`,
);

const uncappedRequest = sampleSizeForDecode(16320, 12240, 0, 0);
check('a missing width/height still caps a 200MP decode', uncappedRequest === 4);

const originalCamera = `
import android.graphics.BitmapFactory;
        File f = new File(imageFileSavePath);
        BitmapFactory.Options bmOptions = new BitmapFactory.Options();
        Uri contentUri = Uri.fromFile(f);
        Bitmap bitmap = BitmapFactory.decodeFile(imageFileSavePath, bmOptions);
            imageStream = getContext().getContentResolver().openInputStream(imageUri);
            Bitmap bitmap = BitmapFactory.decodeStream(imageStream);
            imageStream = getContext().getContentResolver().openInputStream(imageUri);
            Bitmap bitmap = BitmapFactory.decodeStream(imageStream);
`;
const originalUtils = 'import android.graphics.Bitmap;\nimport java.io.IOException;\npublic class ImageUtils {\n    void resize() {}\n}\n';
const once = patchSources(originalCamera, originalUtils);
check('patch rewrites both decode sites', once.changed && once.camera.includes('decodeSampledFile') && (once.camera.match(/decodeSampledUri/g) || []).length === 2);
check('patched plugin no longer full-frame decodes', !once.camera.includes('BitmapFactory.decodeFile') && !once.camera.includes('BitmapFactory.decodeStream'));
check('patched plugin drops the unused BitmapFactory import', !once.camera.includes('import android.graphics.BitmapFactory'));
check('ImageUtils decodes bounds first and disables density scaling', once.utils.includes('FILTERFIT_SUBSAMPLE') && once.utils.includes('inJustDecodeBounds = true') && once.utils.includes('inScaled = false'));
const twice = patchSources(once.camera, once.utils);
check('patch is idempotent', twice.changed === false && twice.utils.split('FILTERFIT_SUBSAMPLE').length === 2);

const cameraPath = path.join(ROOT, 'node_modules/@capacitor/camera/android/src/main/java/com/capacitorjs/plugins/camera/CameraPlugin.java');
const utilsPath = path.join(ROOT, 'node_modules/@capacitor/camera/android/src/main/java/com/capacitorjs/plugins/camera/ImageUtils.java');
if (existsSync(cameraPath) && existsSync(utilsPath)) {
  const cameraSrc = readFileSync(cameraPath, 'utf8');
  const utilsSrc = readFileSync(utilsPath, 'utf8');
  check(
    'postinstall patched CameraPlugin on disk',
    cameraSrc.includes('decodeSampledFile') && !cameraSrc.includes('BitmapFactory.decodeStream') && !cameraSrc.includes('BitmapFactory.decodeFile'),
  );
  check('postinstall patched ImageUtils on disk', utilsSrc.includes('FILTERFIT_SUBSAMPLE') && utilsSrc.includes('decodeSampledUri'));
  const again = patchSources(cameraSrc, utilsSrc);
  check('patching the installed sources again is a no-op', again.changed === false);
} else {
  console.log('SKIP  installed plugin sources (node_modules not present)');
}

console.log(failures.length ? `\n${failures.length} FAILURES` : '\ncamera-subsample: all passed');
process.exit(failures.length ? 1 : 0);
