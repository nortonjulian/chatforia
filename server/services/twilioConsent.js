export async function recordTwilioConsentAction(db, {
  action, messageSid, phone, to, body, reason, rawPayload, ipAddress, userAgent,
}) {
  if (action !== 'STOP' && action !== 'START') {
    throw new TypeError('Unsupported consent action');
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.smsCarrierEvent.create({
        data: {
          providerMessageId: messageSid,
          from: phone,
          to,
          body,
          direction: 'inbound',
          action: action === 'STOP' ? 'opt_out' : 'opt_in',
        },
      });

      if (action === 'START') {
        await tx.smsOptOut.deleteMany({
          where: { phone, provider: 'twilio' },
        });
        return;
      }

      const existing = await tx.smsOptOut.findFirst({
        where: { phone, provider: 'twilio' },
      });
      const data = {
        reason,
        inboundMessageId: messageSid,
        rawPayload,
        ipAddress,
        userAgent,
      };
      if (existing) {
        await tx.smsOptOut.update({
          where: { id: existing.id },
          data: { ...data, createdAt: new Date() },
        });
      } else {
        await tx.smsOptOut.create({
          data: { phone, provider: 'twilio', ...data },
        });
      }
    });
    return { duplicate: false };
  } catch (error) {
    // A unique conflict is a retry only if this exact receipt committed.
    if (error?.code === 'P2002' && await db.smsCarrierEvent.findUnique({
      where: { providerMessageId: messageSid },
    })) return { duplicate: true };
    throw error;
  }
}
