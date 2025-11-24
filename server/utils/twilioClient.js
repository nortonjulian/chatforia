import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  console.warn('Twilio credentials are not set – porting and telephony will not work.');
}

const twilioClient = accountSid && authToken
  ? twilio(accountSid, authToken)
  : null;

export default twilioClient;
