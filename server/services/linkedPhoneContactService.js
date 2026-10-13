export const LINKED_CONTACT_SELECT = {
  id: true, alias: true, favorite: true, externalPhone: true,
  externalName: true, createdAt: true, userId: true,
  user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
};

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

// Keep the user's existing contact ID and move SMS thread references before
// removing a redundant phone-only row. All changes commit together.
export async function upsertLinkedPhoneContact(prisma, input) {
  const { ownerId, userId, externalPhone, alias, externalName, favorite } = input;
  if (!Number.isInteger(ownerId) || !Number.isInteger(userId) || !externalPhone) {
    throw new Error('Valid owner, user, and normalized phone required');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(42105, CAST(${ownerId} AS integer))`;
    const userContact = await tx.contact.findUnique({
      where: { ownerId_userId: { ownerId, userId } },
    });
    const phoneContact = await tx.contact.findUnique({
      where: { ownerId_externalPhone: { ownerId, externalPhone } },
    });

    if (phoneContact?.userId != null && phoneContact.userId !== userId) {
      throw conflict('This number is saved under a different user contact.');
    }
    if (userContact?.externalPhone && userContact.externalPhone !== externalPhone) {
      throw conflict('This user contact already has a different saved number.');
    }

    const canonical = userContact || phoneContact;
    const duplicate = userContact && phoneContact && userContact.id !== phoneContact.id
      ? phoneContact : null;

    const data = {
      userId,
      externalPhone,
      alias: alias ?? userContact?.alias ?? phoneContact?.alias ?? null,
      externalName: externalName ?? userContact?.externalName ?? phoneContact?.externalName ?? null,
      favorite: duplicate
        ? Boolean(userContact.favorite || phoneContact.favorite || favorite)
        : (typeof favorite === 'boolean' ? favorite : canonical?.favorite ?? false),
    };

    if (duplicate) {
      await tx.smsThread.updateMany({
        where: { contactId: duplicate.id, userId: ownerId },
        data: { contactId: canonical.id },
      });
      await tx.contact.delete({ where: { id: duplicate.id } });
    }

    if (canonical) {
      return tx.contact.update({
        where: { id: canonical.id },
        data,
        select: LINKED_CONTACT_SELECT,
      });
    }
    return tx.contact.create({
      data: { ownerId, ...data },
      select: LINKED_CONTACT_SELECT,
    });
  });
}
