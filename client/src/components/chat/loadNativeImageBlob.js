import axiosClient from '@/api/axiosClient';

// A private image is fetched through the existing per-message authorization
// route. The short-lived token is consumed by an API request, never navigation.
export async function loadNativeImageBlob(item, { privateSource, signal } = {}) {
  const reference = item?.url || item?.imageUrl;
  if (!reference) throw new Error('Image unavailable');
  if (privateSource) {
    const { data } = await axiosClient.get(`/private-media/message/${item.id}`, {
      params: { variant: 'file' },
      headers: { 'Cache-Control': 'no-store' },
      signal,
    });
    const response = await axiosClient.get(data.url, {
      responseType: 'blob',
      signal,
      headers: { 'Cache-Control': 'no-store' },
    });
    return response.data instanceof Blob
      ? response.data
      : new Blob([response.data], { type: item.mimeType || 'application/octet-stream' });
  }
  const response = await fetch(reference, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error('Image unavailable');
  return response.blob();
}
