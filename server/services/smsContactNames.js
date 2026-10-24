// Resolve an SMS peer's label from the owner's saved contacts only.
// Account contacts may be saved by userId without an externalPhone; in that
// case use only a phone verified by that account or its currently assigned DID.
// This changes display names, never phone ownership, routing, or block rules.
export function smsPhoneKeys(raw) {
  const cleaned = String(raw || '').trim().replace(/[^\d+]/g, '');
  if (!cleaned) return [];
  const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  return [...new Set([`+${digits}`, digits].filter(Boolean))];
}

export async function loadSmsContactNames(db, ownerId, peerPhones) {
  const keys = [...new Set(peerPhones.flatMap(smsPhoneKeys))];
  const requested = new Set(keys);
  const names = new Map();
  if (!keys.length) return names;

  const contacts = await db.contact.findMany({
    where: {
      ownerId: Number(ownerId),
      OR: [
        { externalPhone: { in: keys } },
        {
          user: {
            is: {
              OR: [
                { assignedNumbers: { some: { e164: { in: keys }, status: 'ASSIGNED' } } },
                { phoneNumber: { in: keys }, phoneVerifiedAt: { not: null } },
              ],
            },
          },
        },
      ],
    },
    select: {
      alias: true,
      externalName: true,
      externalPhone: true,
      user: {
        select: {
          username: true,
          displayName: true,
          phoneNumber: true,
          phoneVerifiedAt: true,
          assignedNumbers: {
            where: { e164: { in: keys }, status: 'ASSIGNED' },
            select: { e164: true },
          },
        },
      },
    },
  });

  // Explicitly saved phone contacts take precedence over inferred account
  // names, preserving the user's chosen label for the exact number.
  for (const c of contacts) {
    const label = c.alias || c.externalName || c.user?.username || c.externalPhone;
    if (!label) continue;
    for (const key of smsPhoneKeys(c.externalPhone)) {
      if (requested.has(key)) names.set(key, label);
    }
  }

  // Recover names after a contact is re-added by username only. Never expose
  // a matched phone in contact records or infer ownership from unverified data.
  for (const c of contacts) {
    if (!c.user) continue;
    const label = c.alias || c.externalName || c.user.displayName || c.user.username;
    if (!label) continue;

    const accountPhones = (c.user.assignedNumbers || []).map(n => n.e164);
    if (c.user.phoneVerifiedAt && c.user.phoneNumber) {
      accountPhones.push(c.user.phoneNumber);
    }
    for (const phone of accountPhones) {
      for (const key of smsPhoneKeys(phone)) {
        if (requested.has(key) && !names.has(key)) names.set(key, label);
      }
    }
  }
  return names;
}
