/**
 * Fetch the current user's voicemails.
 * Returns: { voicemails: Voicemail[] }
 */
export async function fetchVoicemails() {
  const res = await fetch('/api/voicemail', {
    method: 'GET',
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`Failed to load voicemail: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Mark a voicemail as read/unread.
 * @param {string} id - Voicemail ID (cuid)
 * @param {boolean} isRead
 */
export async function setVoicemailRead(id, isRead = true) {
  const res = await fetch(`/api/voicemail/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ isRead }),
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`Failed to update voicemail read state: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Soft-delete a voicemail.
 * @param {string} id - Voicemail ID (cuid)
 */
export async function deleteVoicemail(id) {
  const res = await fetch(`/api/voicemail/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`Failed to delete voicemail: ${res.status} ${text}`);
  }

  return res.json();
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
