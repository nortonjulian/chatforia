export async function fetchFeatures() {
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/features`, {
    credentials: 'include',
  });
  if (!res.ok) return { status: false };
  return res.json();
}
