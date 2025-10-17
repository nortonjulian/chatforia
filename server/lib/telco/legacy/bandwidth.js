function ensureCreds() {
  const { BANDWIDTH_ACCOUNT_ID, BANDWIDTH_USERNAME, BANDWIDTH_PASSWORD } = process.env;
  if (!BANDWIDTH_ACCOUNT_ID || !BANDWIDTH_USERNAME || !BANDWIDTH_PASSWORD) {
    throw new Error('BANDWIDTH_ACCOUNT_ID / BANDWIDTH_USERNAME / BANDWIDTH_PASSWORD are required');
  }
}

async function getMessagingClient() {
  const { BANDWIDTH_USERNAME, BANDWIDTH_PASSWORD } = process.env;
  // 👇 allow tests to inject a mock module without resolver
  const mod = globalThis.__BW_MESSAGING || (await import('@bandwidth/messaging'));
  return new mod.Messaging.Client({
    basicAuthUsername: BANDWIDTH_USERNAME,
    basicAuthPassword: BANDWIDTH_PASSWORD,
  });
}

async function getNumbersClient() {
  const { BANDWIDTH_USERNAME, BANDWIDTH_PASSWORD } = process.env;
  // 👇 allow tests to inject a mock module without resolver
  const mod = globalThis.__BW_NUMBERS || (await import('@bandwidth/numbers'));
  return new mod.Numbers.Client({
    basicAuthUsername: BANDWIDTH_USERNAME,
    basicAuthPassword: BANDWIDTH_PASSWORD,
  });
}

const adapter = {
  providerName: 'bandwidth',

  async sendSms({ to, text, from, clientRef }) {
    ensureCreds();
    const {
      BANDWIDTH_ACCOUNT_ID,
      BANDWIDTH_FROM_NUMBER,
      BANDWIDTH_MESSAGING_APPLICATION_ID,
      BANDWIDTH_APPLICATION_ID,
    } = process.env;

    const applicationId = BANDWIDTH_MESSAGING_APPLICATION_ID || BANDWIDTH_APPLICATION_ID;
    const resolvedFrom = from || BANDWIDTH_FROM_NUMBER;
    if (!resolvedFrom || !applicationId) {
      throw new Error('Missing Bandwidth messaging configuration');
    }

    const client = await getMessagingClient();

    const body = {
      applicationId,
      to: [to],
      from: resolvedFrom,
      text,
      tag: clientRef,
    };

    const res = await client.createMessage(BANDWIDTH_ACCOUNT_ID, body);
    const id = res?.data?.id || res?.id || '';
    return { provider: 'bandwidth', messageId: id };
  },

  async checkNumberAvailability({ areaCode, limit = 20 } = {}) {
    ensureCreds();
    const { BANDWIDTH_ACCOUNT_ID } = process.env;

    const client = await getNumbersClient();

    const params = {};
    if (areaCode) params.areaCode = String(areaCode);
    if (limit) params.quantity = String(limit);

    const res = await client.searchLocalAvailableNumbers(BANDWIDTH_ACCOUNT_ID, params);
    const list = res?.data?.telephoneNumberList?.telephoneNumber || [];
    return list.map((n) => ({ number: String(n), region: undefined }));
  },

  async purchaseNumber(arg) {
    ensureCreds();
    const { BANDWIDTH_ACCOUNT_ID } = process.env;
    const phoneNumber = typeof arg === 'string' ? arg : arg?.phoneNumber;
    if (!phoneNumber) throw new Error('phoneNumber required');

    const client = await getNumbersClient();

    const res = await client.createOrder(BANDWIDTH_ACCOUNT_ID, {
      name: 'Test Order',
      existingTelephoneNumberOrderType: {
        telephoneNumberList: { telephoneNumber: [phoneNumber] },
      },
    });

    const id = res?.data?.order?.id || res?.order?.id || '';
    return { id };
  },

  async releaseNumber(arg) {
    ensureCreds();
    const { BANDWIDTH_ACCOUNT_ID } = process.env;
    const phoneNumber = typeof arg === 'string' ? arg : arg?.phoneNumber;
    if (!phoneNumber) throw new Error('phoneNumber required');

    const client = await getNumbersClient();

    await client.createDisconnectTelephoneNumberOrder(BANDWIDTH_ACCOUNT_ID, {
      disconnectTelephoneNumberOrderType: {
        telephoneNumberList: { telephoneNumber: [phoneNumber] },
      },
    });
  },

  async configureWebhooks() {},
};

export default adapter;