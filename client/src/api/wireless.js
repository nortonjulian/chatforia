import axiosClient from '@/api/axiosClient';

export async function fetchWirelessStatus() {
  const { data } = await axiosClient.get('/api/wireless/status');
  return data;
}

export async function fetchWirelessPurchases() {
  const { data } = await axiosClient.get('/api/wireless/purchases');
  return data;
}

// Dev-only helper: simulate consumption (non-production)
export async function debugConsumeData(mb) {
  const { data } = await axiosClient.post('/api/wireless/debug/consume', { mb });
  return data;
}
