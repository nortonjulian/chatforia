/**
 * Carrier MMS-only image preparation. Chatforia-to-Chatforia attachments
 * still use the original file and their independent storage limits.
 *
 * Canvas intentionally flattens still images into JPEG; animated GIFs are
 * passed through unchanged to preserve animation. MP4 is validated rather
 * than silently transcoded (browsers lack a reliable cross-platform codec).
 */
export const MAX_MMS_BYTES = 5_000_000;
export const MAX_MMS_VIDEO_BYTES = 500_000;
export const TARGET_MMS_JPEG_BYTES = 1_000_000;

export function assertCarrierMmsFile(file, body = '') {
  const mime = String(file?.type || '').toLowerCase();
  const accepted = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'video/mp4']);
  if (!accepted.has(mime)) {
    throw new Error('Carrier MMS accepts photos or small MP4 videos. Use JPEG, PNG, GIF, WebP, HEIC, HEIF, or MP4.');
  }
  if (!Number.isFinite(file?.size) || file.size <= 0) {
    throw new Error('This media file is empty or its size could not be determined.');
  }
  const max = mime === 'video/mp4' ? MAX_MMS_VIDEO_BYTES : MAX_MMS_BYTES;
  if (file.size > max) {
    throw new Error(mime === 'video/mp4'
      ? 'Carrier MMS video must be 500 KB or smaller. Trim or compress it before attaching.'
      : 'This photo exceeds the 5 MB carrier MMS limit. Choose a smaller photo.');
  }
  const captionBytes = new Blob([String(body ?? '')]).size;
  if (file.size + captionBytes > MAX_MMS_BYTES) {
    throw new Error('Media and message text together exceed the 5 MB carrier MMS limit.');
  }
}

function jpegFromCanvas(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode photo for MMS.')), 'image/jpeg', quality);
  });
}

export async function prepareCarrierMmsFile(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type === 'video/mp4' || type === 'image/gif') {
    assertCarrierMmsFile(file);
    return file;
  }
  if (!type.startsWith('image/')) {
    assertCarrierMmsFile(file);
  }

  // Decode first so larger PNGs / HEICs can be reduced before the 5 MB check.
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new Error('This browser cannot prepare the selected photo for carrier MMS.');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This photo format cannot be decoded here. Try exporting it as a JPEG.');
  }

  try {
    if (!bitmap.width || !bitmap.height) {
      throw new Error('Invalid photo dimensions.');
    }
    let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    let encoded = null;
    for (let i = 0; i < 7; i += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser cannot resize the photo for MMS.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      encoded = await jpegFromCanvas(canvas, Math.max(0.45, 0.86 - i * 0.065));
      if (encoded.size <= TARGET_MMS_JPEG_BYTES) break;
      scale *= 0.8;
    }
    if (!encoded || encoded.size > MAX_MMS_BYTES) {
      throw new Error('This photo could not be reduced below the carrier MMS limit.');
    }
    const output = new File([encoded], 'mms-photo.jpg', { type: 'image/jpeg', lastModified: Date.now() });
    assertCarrierMmsFile(output);
    return output;
  } finally {
    bitmap.close?.();
  }
}
