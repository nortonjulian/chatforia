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
  if (size != null && Number.isFinite(Number(size)) && Number(size) > 5 * 1024 * 1024) {
    throw new Error('This attachment exceeds the 5 MiB MMS limit. Choose a smaller file.');
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
