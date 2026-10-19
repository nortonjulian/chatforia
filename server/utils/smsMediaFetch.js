import Boom from '@hapi/boom';
import { fetchTwilioMedia } from './twilioMediaProxy.js';

// Call only after the message/thread ownership check in /sms/media/:id/:index.
// Storage media must never receive Twilio Basic Auth or follow a redirect.
export async function fetchSMSMedia(value) {
  let url;
  try { url = new URL(value); } catch { throw Boom.badRequest('Invalid media URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw Boom.badRequest('Invalid media URL');
  }

  if (/^api(?:\.[a-z0-9-]+){0,2}\.twilio\.com$/i.test(url.hostname)) {
    if (url.port) throw Boom.badRequest('Invalid Twilio media port');
    const sid = process.env.TWILIO_ACCOUNT_SID;
    if (!sid || !url.pathname.startsWith(`/2010-04-01/Accounts/${sid}/Messages/`)) {
      throw Boom.forbidden('Media account mismatch');
    }
    return fetchTwilioMedia(url.href);
  }

  let base;
  try { base = new URL(process.env.R2_PUBLIC_BASE); } catch {
    throw Boom.badRequest('Unsupported media origin');
  }
  const prefix = base.pathname.replace(/\/$/, '') + '/';
  if (base.protocol !== 'https:' || base.username || base.password ||
      url.origin !== base.origin || !url.pathname.startsWith(prefix)) {
    throw Boom.badRequest('Unsupported media origin');
  }
  const response = await fetch(url.href, { redirect: 'error' });
  if (!response.ok) throw Boom.badGateway('Failed to fetch stored media');
  return response;
}
