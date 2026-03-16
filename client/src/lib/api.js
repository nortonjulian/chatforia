import axiosClient from '@/api/axiosClient';

export async function fetchLatestMessages(roomId, limit = 50) {
  const { data } = await axiosClient.get(`/messages/${roomId}`, {
    params: { limit },
    headers: { 'Cache-Control': 'no-cache' },
  });
  return data;
}

export async function fetchOlderMessages(roomId, cursorId, limit = 30) {
  const { data } = await axiosClient.get(`/messages/${roomId}`, {
    params: { cursorId, limit },
  });
  return data;
}

export async function fetchMessageDeltas(roomId, sinceId) {
  const { data } = await axiosClient.get(`/messages/${roomId}/deltas`, {
    params: { sinceId },
  });
  return data;
}