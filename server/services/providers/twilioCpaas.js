import twilio from 'twilio';
const { jwt } = twilio;
const { AccessToken } = jwt;
const { VideoGrant, VoiceGrant } = AccessToken; // use as needed

export function createVideoToken({ identity, room }) {
  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_API_KEY_SID,
    process.env.TWILIO_API_KEY_SECRET,
    { identity }
  );
  token.addGrant(new VideoGrant({ room }));
  return token.toJwt();
}
