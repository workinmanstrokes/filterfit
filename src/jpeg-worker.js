// Decode and downscale a JPEG off the main thread.
// The bitmap that comes back is already capped (see jpeg-scale.js); the
// page never receives a full-resolution frame.
import { decodeJpegScaled } from './jpeg-scale.js';

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    const bytes = new Uint8Array(await msg.blob.arrayBuffer());
    const decoded = await decodeJpegScaled(bytes, {
      maxEdge: msg.maxEdge,
      orientation: msg.orientation || 1,
      deadline: msg.deadline || 0,
      yieldToEventLoop: true,
    });
    const { rgba, width, height } = decoded;
    if (typeof OffscreenCanvas === 'function' && typeof ImageData === 'function') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({
        ok: true,
        bitmap,
        width,
        height,
        sourceWidth: decoded.sourceWidth,
        sourceHeight: decoded.sourceHeight,
        downscaled: decoded.downscaled,
      }, [bitmap]);
      return;
    }
    self.postMessage({
      ok: true,
      rgba,
      width,
      height,
      sourceWidth: decoded.sourceWidth,
      sourceHeight: decoded.sourceHeight,
      downscaled: decoded.downscaled,
    }, [rgba.buffer]);
  } catch (err) {
    self.postMessage({
      ok: false,
      error: String((err && err.message) || err || 'decode'),
      code: (err && err.code) || '',
    });
  }
};
