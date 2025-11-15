export const ESIM_ENABLED = process.env.FEATURE_ESIM === 'true';
export const TEAL = {
  baseUrl: process.env.TEAL_BASE_URL,
  apiKey: process.env.TEAL_API_KEY,
  webhookSecret: process.env.TEAL_WEBHOOK_SECRET,
  callbackUrl: process.env.TEAL_CALLBACK_URL,
  partnerId: process.env.TEAL_PARTNER_ID,
  defaultPlanId: process.env.TEAL_DEFAULT_PLAN_ID,
};
