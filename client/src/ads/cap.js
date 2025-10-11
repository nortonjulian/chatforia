export const DEV_DISABLE_CAPS =
  import.meta.env.VITE_DEV_DISABLE_AD_CAPS === "true";
export function canShow(key) {
  if (DEV_DISABLE_CAPS) return true;
  // ...existing logic...
}
