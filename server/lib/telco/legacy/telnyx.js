const API = 'https://api.telnyx.com/v2';

function authHeader() {
  const key = process.env.TELNYX_API_KEY;
  if (!key) return null;
  return { Authorization: `Bearer ${key}` };
}

function ensureKey() {
  if (!process.env.TELNYX_API_KEY) {
    throw new Error('TELNYX_API_KEY is not set');
  }
}

async function telnyxFetch(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...authHeader(),
    ...(opts.headers || {}),
  };
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telnyx API ${path} failed: ${res.status} ${text || res.statusText}`);
  }
  return res.json();
}

const adapter = {
  providerName: 'telnyx',

  /**
   * Send SMS (REST v2)
   * returns: { provider: 'telnyx', messageId: string }
   */
  async sendSms({ to, text, clientRef }) {
    ensureKey();
    if (!to || !text) throw new Error('to and text required');
    const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID || undefined;
    const from = process.env.TELNYX_FROM_NUMBER || undefined;

    const body = {
      to,
      text,
      ...(from ? { from } : {}),
      ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}),
      ...(clientRef ? { client_ref: clientRef } : {}),
    };

    const json = await telnyxFetch('/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const id = json?.data?.id || json?.id || null;
    return { provider: 'telnyx', messageId: id };
  },

  /**
   * Check number availability, mapping to [{ number, region }]
   */
  async checkNumberAvailability({ areaCode, country = 'US', type = 'local', limit = 20 } = {}) {
    if (!process.env.TELNYX_API_KEY) {
      // keep routes functional in dev without a key
      return [];
    }

    const qs = new URLSearchParams();
    if (country) qs.set('filter[country_code]', country);
    if (areaCode) qs.set('filter[national_destination_code]', String(areaCode));
    if (type) qs.set('filter[phone_number_type]', type);
    if (limit) qs.set('page[size]', String(limit));

    const json = await telnyxFetch(`/available_phone_numbers?${qs.toString()}`, { method: 'GET' });
    const data = Array.isArray(json?.data) ? json.data : [];
    return data.map((n) => ({
      number: n?.phone_number || n?.phoneNumber || n?.number,
      region: n?.locality || n?.region || null,
    })).filter(x => x.number);
  },

  /**
   * Search available numbers (returns { items: string[] })
   */
  async searchAvailable({ areaCode, country = 'US', type = 'local', limit = 20 } = {}) {
    if (!process.env.TELNYX_API_KEY) {
      console.warn('[telnyx] TELNYX_API_KEY missing — returning empty search results.');
      return { items: [] };
    }

    const qs = new URLSearchParams();
    if (country) qs.set('filter[country_code]', country);
    if (areaCode) qs.set('filter[national_destination_code]', String(areaCode));
    if (type) qs.set('filter[phone_number_type]', type);
    if (limit) qs.set('page[size]', String(limit));

    const json = await telnyxFetch(`/available_phone_numbers?${qs.toString()}`, { method: 'GET' });
    const items =
      (json?.data || [])
        .map((n) => n?.phone_number || n?.phoneNumber || n?.number)
        .filter(Boolean);

    return { items };
  },

  /**
   * Purchase/provision a number
   * Accepts: { phoneNumber } OR a string
   * Returns: { id }
   */
  async purchaseNumber(arg) {
    ensureKey();
    const phoneNumber = typeof arg === 'string' ? arg : arg?.phoneNumber;
    if (!phoneNumber) throw new Error('phoneNumber required');

    const body = { phone_numbers: [{ phone_number: phoneNumber }] };
    const json = await telnyxFetch('/number_orders', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const id = json?.data?.id || json?.id || null;
    return { id };
  },

  /**
   * Release a number
   * Accepts: { phoneNumber } OR a string
   */
  async releaseNumber(arg) {
    ensureKey();
    const phoneNumber = typeof arg === 'string' ? arg : arg?.phoneNumber;
    if (!phoneNumber) throw new Error('phoneNumber required');

    const enc = encodeURIComponent(phoneNumber);
    await telnyxFetch(`/phone_numbers/${enc}`, { method: 'DELETE' });
  },

  async configureWebhooks(_p) {
    return;
  },
};

export default adapter;