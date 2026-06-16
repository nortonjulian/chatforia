import axiosClient from './axiosClient';

export async function getCallHistoryPage({ limit = 50, cursor } = {}) {
  const params = { limit };

  if (cursor) {
    params.cursor = cursor;
  }

  const { data } = await axiosClient.get('/calls/history', { params });

  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor ?? null,
  };
}

export async function getCallHistory(options = {}) {
  const page = await getCallHistoryPage(options);
  return page.items;
}