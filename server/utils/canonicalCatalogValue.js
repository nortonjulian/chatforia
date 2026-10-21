// Resolve a supported sound ID case-insensitively, but preserve the server's
// canonical filename. Unknown IDs must never bypass plan enforcement.
export function canonicalCatalogValue(input, allowed) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  return allowed.find((entry) => entry.toLowerCase() === value) ?? null;
}
