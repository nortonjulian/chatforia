import axiosClient from './axiosClient';

// ---- Core subscription checkout (Plus / Premium) ----

// plan: "PLUS_MONTHLY" | "PREMIUM_MONTHLY" | "PREMIUM_ANNUAL"
export async function startUpgradeCheckout(plan) {
  try {
    const { data } = await axiosClient.post('/billing/checkout', { plan });
    // { url, checkoutUrl }
    return data;
  } catch (err) {
    console.error('startUpgradeCheckout error:', err?.response?.data || err);
    throw new Error('Failed to start upgrade checkout');
  }
}

// Open the Stripe Billing Portal (manage subscription)
export async function openBillingPortal() {
  try {
    const { data } = await axiosClient.post('/billing/portal', {});
    // { url, portalUrl }
    return data;
  } catch (err) {
    console.error('openBillingPortal error:', err?.response?.data || err);
    throw new Error('Failed to open billing portal');
  }
}

// ---- Add-ons: Family data packs & eSIM packs (one-time payments) ----

// size: "SMALL" | "MEDIUM" | "LARGE"
export async function createFamilyCheckoutSession(size = 'MEDIUM') {
  const addonKind = `FAMILY_${size}`; // e.g. "FAMILY_MEDIUM"

  try {
    const { data } = await axiosClient.post('/billing/checkout-addon', {
      addonKind,
    });
    // { url, checkoutUrl }
    return data;
  } catch (err) {
    console.error('createFamilyCheckoutSession error:', err?.response?.data || err);
    throw new Error('Failed to start Family pack checkout');
  }
}

// kind: "STARTER" | "TRAVELER" | "POWER"
export async function createEsimCheckoutSession(kind = 'STARTER') {
  const addonKind = `ESIM_${kind}`; // e.g. "ESIM_STARTER"

  try {
    const { data } = await axiosClient.post('/billing/checkout-addon', {
      addonKind,
    });
    // { url, checkoutUrl }
    return data;
  } catch (err) {
    console.error('createEsimCheckoutSession error:', err?.response?.data || err);
    throw new Error('Failed to start eSIM pack checkout');
  }
}
