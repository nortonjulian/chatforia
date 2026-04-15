import { API_BASE_URL } from '@/config';

async function safeErr(res, fallback) {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

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

  const res = await fetch(`${API_BASE_URL}/chatrooms?${qs.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(await safeErr(res, 'Failed to fetch chatrooms'));
  }

  return res.json();
}

export async function createGroupChatroom(userIds, name) {
  const res = await fetch(`${API_BASE_URL}/chatrooms/group`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds, name }),
  });

  if (!res.ok) {
    throw new Error(await safeErr(res, 'Error creating group chatroom'));
  }

  return res.json();
}

export async function findOrCreateOneToOneChat(targetUserId) {
  const res = await fetch(`${API_BASE_URL}/chatrooms/direct/${targetUserId}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(await safeErr(res, 'Error creating/finding 1:1 chat'));
  }

  return res.json();
}