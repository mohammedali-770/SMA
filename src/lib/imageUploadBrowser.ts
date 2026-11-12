/**
 * Resize and re-encode a picked photo in the browser before it is uploaded.
 * Every decision is in `imageUpload.ts`; this file only applies them with
 * `createImageBitmap` and a canvas.
 *
 * It never makes an upload fail. Any error — a browser without
 * `createImageBitmap`, a file it cannot decode, a canvas the GPU refuses —
 * returns the original file, which is what was uploaded before this existed and
 * which the bucket already accepts.
 *
 * Drawing to a canvas also drops the file's metadata, EXIF GPS included.
 */
import {
  chooseUpload,
  downscaleSteps,
  encoderHonoured,
  encodingsToTry,
  hasTransparency,
  mayHaveAlpha,
  renameForMime,
  type Size,
  type UploadMime,
  type UploadPlan,
} from './imageUpload';

/** `planProductImageUpload` or `planBannerUpload`: the bucket decides its own bound. */
export type UploadPlanner = (input: Size & { bytes: number }) => UploadPlan;

function canvasOf({ width, height }: Size): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function draw(source: CanvasImageSource, size: Size): HTMLCanvasElement {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, mime: UploadMime, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

export async function prepareImageForUpload(file: File, plan: UploadPlanner): Promise<File> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const original = { width: bitmap.width, height: bitmap.height };
    const decision = plan({ ...original, bytes: file.size });
    if (decision.action === 'keep') return file;
    const target = decision.target;

    let canvas: HTMLCanvasElement | null = null;
    let source: CanvasImageSource = bitmap;
    for (const step of downscaleSteps(original, target)) {
      canvas = draw(source, step);
      source = canvas;
    }
    if (!canvas) return file;

    let alpha = false;
    if (mayHaveAlpha(file)) {
      const ctx = canvas.getContext('2d');
      alpha = ctx ? hasTransparency(ctx.getImageData(0, 0, canvas.width, canvas.height).data) : true;
    }

    for (const { mime, quality } of encodingsToTry(alpha)) {
      const blob = await toBlob(canvas, mime, quality);
      if (!blob || !encoderHonoured(mime, blob.type)) continue;
      const fits = target.width === original.width && target.height === original.height;
      if (
        chooseUpload({ originalBytes: file.size, originalFits: fits, encodedBytes: blob.size }) === 'original'
      ) {
        return file;
      }
      return new File([blob], renameForMime(file.name, mime), { type: mime, lastModified: Date.now() });
    }
    return file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
