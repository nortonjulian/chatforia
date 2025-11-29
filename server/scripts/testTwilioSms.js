import { sendSms } from '../server/lib/telco/index.js';

(async () => {
  try {
    const res = await sendSms({
      to: '+1XXXXXXXXXX',      // <- your real mobile in E.164
      text: 'Chatforia test SMS via Twilio',
    });
    console.log('SMS sent OK', res);
  } catch (e) {
    console.error('SMS test failed', e);
  } finally {
    process.exit(0);
  }
})();
