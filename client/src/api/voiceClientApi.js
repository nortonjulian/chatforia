import axiosClient from './axiosClient';

/**
 * Fetch a Twilio Voice Access Token for the current user.
 * Server route: POST /voice/token
 *
 * Response shape:
 *   { token: string, identity: string, ttlSeconds?: number }
 */
export async function fetchVoiceToken() {
  const res = await axiosClient.post('/voice/token');
  return res.data;
}
