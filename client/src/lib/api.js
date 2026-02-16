/* =========================================================
 * Message API (Sprint 7 canonical pagination contract)
 * ========================================================= */

/**
 * Server response shape:
 * {
 *   items: Message[],
 *   nextCursor: string | null,
 *   nextCursorId: number | null,
 *   count: number
 * }
 */

function normalizePage(data) {
  return {
    items: data?.items || [],
    nextCursor: data?.nextCursor ?? null,
    nextCursorId: data?.nextCursorId ?? null,
    count: data?.count ?? (data?.items?.length || 0),
  };
}

/**
 * 1️⃣ Fetch newest page
 */
export async function fetchLatestMessages(roomId, limit = 50) {
  if (!roomId) return normalizePage(null);

  const { data } = await api.get(`/messages/${roomId}`, {
    params: { limit },
  });

  return normalizePage(data);
}

/**
 * 2️⃣ Fetch older messages (pagination scrollback)
 * Uses cursorId returned from previous page
 */
export async function fetchOlderMessages(roomId, cursorId, limit = 50) {
  if (!roomId) return normalizePage(null);

  const params = { limit };
  if (cursorId != null) params.cursorId = cursorId;

  const { data } = await api.get(`/messages/${roomId}`, { params });
  return normalizePage(data);
}

/**
 * 3️⃣ Deterministic resync — deltas since last known message
 * IMPORTANT: sinceId=0 must be allowed (cold start recovery)
 */
export async function fetchMessageDeltas(roomId, sinceId = 0) {
  if (!roomId) return normalizePage(null);

  const { data } = await api.get(`/messages/${roomId}/deltas`, {
    params: { sinceId: Number(sinceId) || 0 },
  });

  return normalizePage(data);
}