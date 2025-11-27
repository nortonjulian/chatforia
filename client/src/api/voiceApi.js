import axiosClient from './axiosClient';

/**
 * Start an outbound PSTN alias call via Chatforia:
 * POST /calls/pstn  { to: "<number>" }
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
  const { data } = await axiosClient.post('/calls/pstn', { to: rawTo });

  return {
    ok: !!data?.success,
    callSid: data?.callSid ?? null,
    raw: data,
  };
}
