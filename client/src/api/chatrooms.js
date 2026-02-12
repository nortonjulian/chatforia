const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/**
 * List chatrooms with composite cursor (updatedAt + id).
 * Pass { userId } to filter rooms the user belongs to.
 * Returns { items, nextCursor, count }
 */
export async function getChatrooms({
  limit = 30,
  userId,
  cursorId,
  cursorUpdatedAt,
} = {}) {
  const qs = new URLSearchParams();
  qs.set('limit', String(limit));
  if (userId) qs.set('userId', String(userId));
  if (cursorId && cursorUpdatedAt) {
    qs.set('cursorId', String(cursorId));
    qs.set('cursorUpdatedAt', new Date(cursorUpdatedAt).toISOString());
  }

  const res = await fetch(`${API_BASE}/chatrooms?${qs.toString()}`, {
    method: 'GET',
    credentials: 'include', // send HTTP-only JWT cookie
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const msg = await safeErr(res, 'Failed to fetch chatrooms');
    throw new Error(msg);
  }
  return res.json(); // { items, nextCursor, count }
}

/**
 * Create (or find) a group chat with exact set of members.
 * userIds: number[]
 * name: optional string
 */
export async function createGroupChatroom(userIds, name) {
  const res = await fetch(`${API_BASE}/chatrooms/group`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds, name }),
  });

  if (!res.ok) {
    const msg = await safeErr(res, 'Error creating group chatroom');
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Find or create a 1:1 chat with target user.
 * NOTE: server route is POST /chatrooms/direct/:targetUserId
 */
export async function findOrCreateOneToOneChat(targetUserId) {
  const res = await fetch(`${API_BASE}/chatrooms/direct/${targetUserId}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const msg = await safeErr(res, 'Error creating/finding 1:1 chat');
    throw new Error(msg);
  }
  return res.json();
}

// small helper to surface backend error messages
async function safeErr(res, fallback) {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}
