import prisma from '../utils/prismaClient.js';
import { sendMail } from './sendMail.js';

export async function notifyUserOfPendingRelease(userId, { number, releaseDate }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.email) {
    console.warn(`[Notify] No email found for user ${userId}`);
    return;
  }

  const greetingName = user.displayName || user.username || 'there';

  const msg = {
    to: user.email,
    from: 'no-reply@chatforia.com', // ✅ Must be verified in SendGrid
    subject: 'Your Chatforia number will be released soon',
    text: `Hi ${greetingName},\n\nYour Chatforia number ${number} has been inactive and will be released on ${releaseDate.toDateString()}.\n\nTo keep this number, just send or receive a message before that date.\n\n— The Chatforia Team`,
    html: `
      <p>Hi ${greetingName},</p>
      <p>Your Chatforia number <strong>${number}</strong> has been inactive and will be released on <strong>${releaseDate.toDateString()}</strong>.</p>
      <p>To keep this number, just send or receive a message before that date.</p>
      <p>— The Chatforia Team</p>
    `
  };

  const result = await sendMail(msg);

  if (!result?.success) {
    throw result?.error || new Error('Email send failed');
  }

  console.log(`[Notify] Email sent: userId=${userId}`);
}
