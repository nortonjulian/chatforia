// import api from './axiosClient';

export async function fetchLanguages() {
  const res = await fetch('/languages');
  if (!res.ok) throw new Error('Failed to load languages');
  return await res.json();
}
