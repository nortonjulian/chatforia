import axiosClient from '@/api/axiosClient';

export async function fetchWirelessStatus() {
  const { data } = await axiosClient.get('/api/wireless/status');
  return data;
}

// Dev-only helper: simulate consumption (non-production)
export async function debugConsumeData(mb) {
  const { data } = await axiosClient.post('/api/wireless/debug/consume', { mb });
  return data;
}