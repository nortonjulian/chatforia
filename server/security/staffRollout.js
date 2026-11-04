// A production dashboard rollout requires a bounded, explicit canary cohort.
// These IDs limit exposure only; all normal authentication/RBAC checks still run.
export function staffCanaryIds(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parts = value.split(',').map((part) => part.trim());
  if (
    parts.length > 200 ||
    parts.some(
      (part) => !/^[1-9][0-9]*$/.test(part) || Number(part) > 2147483647
    )
  )
    return null;
  return [...new Set(parts.map(Number))];
}

export function staffCohortAllows(userId, env = process.env) {
  if (!env.STAFF_DASHBOARD_USER_IDS && env.NODE_ENV !== 'production')
    return true;
  return (
    staffCanaryIds(env.STAFF_DASHBOARD_USER_IDS)?.includes(userId) === true
  );
}
