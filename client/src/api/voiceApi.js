import axiosClient from './axiosClient';

/**
 * Start an outbound PSTN alias call via Chatforia.
 *
 * Clean flow:
 * 1. Create one backend Call row with /calls/start-external
 * 2. Start the Twilio call with /voice/call and pass that callId
 * 3. voiceBridge saves the Twilio CallSid onto the same Call row
 */
export async function startAliasCall(rawTo) {
  const { data: started } = await axiosClient.post('/calls/start-external', {
    phoneNumber: rawTo,
    mode: 'AUDIO',
  });

  const callId =
    started?.resolvedCallId ||
    started?.callId ||
    started?.call?.id ||
    null;

  const body = {
    to: rawTo,
  };

  if (callId) {
    body.callId = callId;
  }

  const { data } = await axiosClient.post('/voice/call', body);

  const resolvedCallId =
    data?.resolvedCallId ||
    data?.callId ||
    callId ||
    null;

  return {
    ok: !!data?.ok || !!data?.callSid,
    callSid: data?.callSid ?? null,
    callId: resolvedCallId,
    resolvedCallId,
    raw: data,
    startRaw: started,
  };
}