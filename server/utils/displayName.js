export function resolveDisplayName(user, contactMap) {
  if (!user) return null;

  return (
    contactMap?.get(Number(user.id)) ||
    user.displayName ||
    user.username ||
    user.phoneNumber ||
    null
  );
}