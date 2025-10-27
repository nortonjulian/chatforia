import crypto from 'crypto';
import prisma from '../utils/prismaClient.js';
import { sendSms } from '../lib/telco/index.js'; 

export async function createInvitesAndText({ eventId, recipients }) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new Error('Event not found');

  const base = process.env.PUBLIC_SHORT_BASE_URL || 'https://co.bt';
  const invites = [];

  for (const r of recipients) {
    const token = crypto.randomBytes(6).toString('base64url'); // ~8-10 chars
    const invite = await prisma.eventInvite.create({
      data: { eventId, phoneE164: r.phoneE164, name: r.name || null, token },
    });
    invites.push(invite);

    const shortUrl = `${base}/e/${token}`;
    const msg = [
      r.name ? `Hi ${r.name},` : 'Hi,',
      `You're invited: ${event.title}`,
      event.location ? `Where: ${event.location}` : null,
      `When: ${new Date(event.startUTC).toLocaleString()} – ${new Date(event.endUTC).toLocaleString()}`,
      `Add to calendar & RSVP: ${shortUrl}`,
    ].filter(Boolean).join('\n');

    await sendSms(r.phoneE164, msg);
    await prisma.eventInvite.update({ where: { id: invite.id }, data: { deliveredAt: new Date() } });
  }

  return invites;
}
