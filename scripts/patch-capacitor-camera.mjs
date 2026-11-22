#!/usr/bin/env node
// @capacitor/camera 7.0.5 decodes the camera file with BitmapFactory and no
// inSampleSize, THEN scales. A 200MP Samsung frame is ~800MB of ARGB and the
// Android app freezes or dies before JavaScript ever sees the photo.
//
// Width/height on Camera.getPhoto() only run after that full decode, so they
// do not fix it. This patch subsamples while decoding, capping the bitmap's
// long edge at 4096 (a 12MP photo stays full size; 50–200MP does not).
//
// android/ is generated in CI from node_modules, so the patch is applied to
// the plugin sources on postinstall and ships inside the Gradle build.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAMERA = path.join(
  ROOT,
  'node_modules/@capacitor/camera/android/src/main/java/com/capacitorjs/plugins/camera/CameraPlugin.java',
);
const UTILS = path.join(
  ROOT,
  'node_modules/@capacitor/camera/android/src/main/java/com/capacitorjs/plugins/camera/ImageUtils.java',
);

// Keep this in lockstep with ImageUtils.calculateInSampleSize below.
// Unlike Android's usual half-size loop, this steps until the DECODED long
// edge is within the cap. The usual loop stops one power of two early, which
// still leaves a ~200MP photo as an ~8000px / 200MB bitmap.
export function sampleSizeForDecode(width, height, reqWidth = 0, reqHeight = 0, maxEdge = 4096) {
  let inSampleSize = 1;
  if (width <= 0 || height <= 0) return 1;
  const targetW = reqWidth > 0 ? Math.min(reqWidth, maxEdge) : maxEdge;
  const targetH = reqHeight > 0 ? Math.min(reqHeight, maxEdge) : maxEdge;
  while (inSampleSize < 64) {
    const decodedW = Math.floor(width / inSampleSize);
    const decodedH = Math.floor(height / inSampleSize);
    const tooBig = decodedW > targetW || decodedH > targetH || Math.max(decodedW, decodedH) > maxEdge;
    if (!tooBig) break;
    const next = inSampleSize * 2;
    if (Math.floor(width / next) < 1 || Math.floor(height / next) < 1) break;
    inSampleSize = next;
  }
  return inSampleSize;
}

const SUBSAMPLE_METHODS = `
    /**
     * FILTERFIT_SUBSAMPLE
     * Decode so the bitmap's long edge stays within 4096px (or the caller's
     * smaller width/height). A full-resolution 50–200MP decode is what froze
     * the app. inScaled is off so display density cannot inflate the bitmap.
     */
    public static int calculateInSampleSize(int width, int height, int reqWidth, int reqHeight) {
        final int maxEdge = 4096;
        int inSampleSize = 1;
        if (width <= 0 || height <= 0) {
            return 1;
        }
        final int targetW = reqWidth > 0 ? Math.min(reqWidth, maxEdge) : maxEdge;
        final int targetH = reqHeight > 0 ? Math.min(reqHeight, maxEdge) : maxEdge;
        while (inSampleSize < 64) {
            int decodedW = width / inSampleSize;
            int decodedH = height / inSampleSize;
            boolean tooBig = decodedW > targetW || decodedH > targetH || Math.max(decodedW, decodedH) > maxEdge;
            if (!tooBig) {
                break;
            }
            int next = inSampleSize * 2;
            if (width / next < 1 || height / next < 1) {
                break;
            }
            inSampleSize = next;
        }
        return inSampleSize;
    }

    public static Bitmap decodeSampledFile(String path, int reqWidth, int reqHeight) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, bounds);
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, reqWidth, reqHeight);
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        opts.inScaled = false;
        return BitmapFactory.decodeFile(path, opts);
    }

    /**
     * Content URIs often cannot rewind, so inSampleSize is ignored on
     * decodeStream. Copy to a cache file and decodeFile instead.
     */
    public static Bitmap decodeSampledUri(Context context, Uri uri, int reqWidth, int reqHeight) {
        File tmp = null;
        try {
            tmp = File.createTempFile("filterfit-cam", ".img", context.getCacheDir());
            try (InputStream in = context.getContentResolver().openInputStream(uri)) {
                if (in == null) {
                    return null;
                }
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                    }
                }
            }
            return decodeSampledFile(tmp.getAbsolutePath(), reqWidth, reqHeight);
        } catch (IOException ex) {
            return null;
        } finally {
            if (tmp != null) {
                tmp.delete();
            }
        }
    }
`;

export function patchSources(camera, utils) {
  const already = camera.includes('decodeSampledFile') && utils.includes('FILTERFIT_SUBSAMPLE');
  if (already) return { camera, utils, changed: false };

  let nextCamera = camera.replace(
    /BitmapFactory\.Options bmOptions = new BitmapFactory\.Options\(\);\s*Uri contentUri = Uri\.fromFile\(f\);\s*Bitmap bitmap = BitmapFactory\.decodeFile\(imageFileSavePath, bmOptions\);/,
    `Uri contentUri = Uri.fromFile(f);
        Bitmap bitmap = ImageUtils.decodeSampledFile(imageFileSavePath, settings.getWidth(), settings.getHeight());`,
  );
  nextCamera = nextCamera.replaceAll(
    /imageStream = getContext\(\)\.getContentResolver\(\)\.openInputStream\(imageUri\);\s*Bitmap bitmap = BitmapFactory\.decodeStream\(imageStream\);/g,
    `Bitmap bitmap = ImageUtils.decodeSampledUri(getContext(), imageUri, settings.getWidth(), settings.getHeight());`,
  );

  if (!nextCamera.includes('decodeSampledFile') || (nextCamera.match(/decodeSampledUri/g) || []).length < 2) {
    throw new Error(
      'patch-capacitor-camera: CameraPlugin.java did not match @capacitor/camera 7.0.5. The full-resolution decode is still in place.',
    );
  }
  if (nextCamera.includes('BitmapFactory.decodeStream') || nextCamera.includes('BitmapFactory.decodeFile')) {
    throw new Error('patch-capacitor-camera: a full-frame BitmapFactory decode is still present.');
  }
  // The plugin class no longer touches BitmapFactory; an unused import can fail a strict javac.
  if (!nextCamera.includes('BitmapFactory.')) {
    nextCamera = nextCamera.replace('import android.graphics.BitmapFactory;\n', '');
  }

  let nextUtils = utils;
  if (!nextUtils.includes('import android.graphics.BitmapFactory;')) {
    nextUtils = nextUtils.replace(
      'import android.graphics.Bitmap;\n',
      'import android.graphics.Bitmap;\nimport android.graphics.BitmapFactory;\n',
    );
  }
  if (!nextUtils.includes('import java.io.File;')) {
    nextUtils = nextUtils.replace(
      'import java.io.IOException;\n',
      'import java.io.File;\nimport java.io.FileOutputStream;\nimport java.io.IOException;\n',
    );
  }
  const close = nextUtils.lastIndexOf('}');
  if (close < 0) throw new Error('patch-capacitor-camera: ImageUtils.java has no class body.');
  nextUtils = `${nextUtils.slice(0, close)}${SUBSAMPLE_METHODS}\n}\n`;
  if (!nextUtils.includes('FILTERFIT_SUBSAMPLE') || !nextUtils.includes('inJustDecodeBounds = true') || !nextUtils.includes('inScaled = false')) {
    throw new Error('patch-capacitor-camera: failed to add subsampled decoding to ImageUtils.java.');
  }
  return { camera: nextCamera, utils: nextUtils, changed: true };
}

function main() {
  if (!existsSync(CAMERA) || !existsSync(UTILS)) {
    console.log('patch-capacitor-camera: plugin sources not installed, skipping');
    return;
  }
  const patched = patchSources(readFileSync(CAMERA, 'utf8'), readFileSync(UTILS, 'utf8'));
  if (!patched.changed) {
    console.log('patch-capacitor-camera: already patched');
    return;
  }
  writeFileSync(CAMERA, patched.camera);
  writeFileSync(UTILS, patched.utils);
  console.log('patch-capacitor-camera: large photos now subsample while decoding');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
