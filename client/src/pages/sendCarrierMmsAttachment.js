/**
 * Send a completed attachment through the carrier SMS/MMS endpoint.
 * The backend authorizes private upload references and signs
 * temporary media-delivery URLs for the carrier.
 */
export async function sendCarrierMmsAttachment({
  axiosClient,
  toNumber,
  text = '',
  fileMeta,
}) {
  const mediaRef = fileMeta?.key || fileMeta?.url;

  // Guard on known metadata; backend remains authoritative for stored bytes.
  const mimeType = fileMeta?.mimeType || fileMeta?.contentType || fileMeta?.type;
  const size = fileMeta?.size;
  const accepted = new Set(['image/jpeg', 'image/png', 'image/gif', 'video/mp4']);
  if (mimeType && !accepted.has(mimeType)) {
    throw new Error('MMS supports JPEG, PNG, GIF, and MP4 files. Choose a supported attachment.');
  }
  const bytes = Number(size);
  const bodyBytes = new TextEncoder().encode(String(text ?? '')).length;
  if (size != null && Number.isFinite(bytes)) {
    if (mimeType === 'video/mp4' && bytes > 500_000) {
      throw new Error('Carrier MMS video must be 500 KB or smaller.');
    }
    if (bytes + bodyBytes > 5_000_000) {
      throw new Error('Attachment and message text exceed the 5 MB carrier MMS limit.');
    }
  }
  if (bodyBytes >= 5_000_000) {
    throw new Error('MMS text exceeds the 5 MB carrier MMS limit.');
  }

  if (!toNumber || !mediaRef) {
    throw new Error('Missing MMS recipient or media reference.');
  }

  return axiosClient.post('/sms/send', {
    to: toNumber,
    body: text,
    mediaUrls: [mediaRef],
  });
}
