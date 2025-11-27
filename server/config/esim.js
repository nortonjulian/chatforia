// More forgiving flag: "true", "1", "TRUE" all work
export const ESIM_ENABLED = (() => {
  const raw = String(process.env.FEATURE_ESIM ?? '').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
})();

// Telna eSIM configuration
export const TELNA = {
  baseUrl: process.env.TELNA_BASE_URL || process.env.TELNA_API_BASE || null,
  apiKey: process.env.TELNA_API_KEY || null,
  webhookSecret: process.env.TELNA_WEBHOOK_SECRET || null,
  callbackUrl: process.env.TELNA_CALLBACK_URL || null,
  partnerId: process.env.TELNA_PARTNER_ID || null,
  defaultPlanId: process.env.TELNA_DEFAULT_PLAN_ID || null,
};
