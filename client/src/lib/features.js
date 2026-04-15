import { API_BASE_URL } from '@/config';

export async function fetchFeatures() {
  const res = await fetch(`${API_BASE_URL}/features`, {
    credentials: 'include',
  });

  if (!res.ok) return { status: false };
  return res.json();
}