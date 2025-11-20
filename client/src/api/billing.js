export async function startUpgradeCheckout(plan) {
  // plan: "PLUS_MONTHLY" | "PREMIUM_MONTHLY" | "PREMIUM_ANNUAL"
  const res = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });

  if (!res.ok) {
    throw new Error('Failed to start upgrade checkout');
  }

  // { url, checkoutUrl }
  return res.json();
}

// Open the Stripe Billing Portal (manage subscription)
export async function openBillingPortal() {
  const res = await fetch('/api/billing/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error('Failed to open billing portal');
  }

  return res.json(); // { url, portalUrl }
}

// ---- Add-ons: Family data packs & eSIM packs (one-time payments) ----

// size: "SMALL" | "MEDIUM" | "LARGE"
export async function createFamilyCheckoutSession(size = 'MEDIUM') {
  const addonKind = `FAMILY_${size}`; // e.g. "FAMILY_MEDIUM"

  const res = await fetch('/api/billing/checkout-addon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addonKind }),
  });

  if (!res.ok) {
    throw new Error('Failed to start Family pack checkout');
  }

  // { url, checkoutUrl }
  return res.json();
}

// kind: "STARTER" | "TRAVELER" | "POWER"
export async function createEsimCheckoutSession(kind = 'STARTER') {
  const addonKind = `ESIM_${kind}`; // e.g. "ESIM_STARTER"

  const res = await fetch('/api/billing/checkout-addon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addonKind }),
  });

  if (!res.ok) {
    throw new Error('Failed to start eSIM pack checkout');
  }

  return res.json();
}
