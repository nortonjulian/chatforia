export function premiumPreviewEnabled() {
  // Dev-only: never enable on prod/staging builds
  if (!import.meta.env.DEV) return false;

  // Allow qs toggle for quick tests
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.has('premiumPreview')) return true;
  } catch {}

  // Or a local toggle so you don't need the qs every time
  return localStorage.getItem('premiumPreview') === '1';
}
