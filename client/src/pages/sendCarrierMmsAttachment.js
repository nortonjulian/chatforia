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

  if (!toNumber || !mediaRef) {
    throw new Error('Missing MMS recipient or media reference.');
  }

  return axiosClient.post('/sms/send', {
    to: toNumber,
    body: text,
    mediaUrls: [mediaRef],
  });
}
