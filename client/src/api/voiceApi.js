import axiosClient from './axiosClient';

/**
 * Start an outbound PSTN alias call via Chatforia:
 * Backend will normalize to E.164 and validate.
 *
 * Server response:
 *   { success: boolean, callSid?: string }
 *
 * We normalize to:
 *   { ok: boolean, callSid?: string, raw: any }
 * so usePstnCall can rely on result.ok.
 */
export async function startAliasCall(rawTo) {
  const { data } = await axiosClient.post('/voice/call', { to: rawTo });

  return {
    ok: !!data?.ok || !!data?.callSid,
    callSid: data?.callSid ?? null,
    raw: data,
  };
}
