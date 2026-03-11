import Boom from '@hapi/boom';
import bcrypt from 'bcrypt';
import prisma from '../../utils/prismaClient.js';
import { createResetToken, consumeResetToken } from '../../utils/tokenStore.js';
import { sendMail } from '../../utils/sendMail.js';
import { passwordResetEmailTemplate } from '../../utils/emailTemplates.js';

const APP_ORIGIN = (process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
const SALT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

/**
 * 1) User submits email; if found, create token and email a link.
 *    (We do NOT reveal whether email exists—return 200 either way.)
 */
export async function requestPasswordReset(emailRaw) {
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!email) throw Boom.badRequest('email required');

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, username: true, email: true }
  });

  // Always behave the same to prevent enumeration
  if (!user) return { ok: true };

  const { token, expiresAt } = await createResetToken(user.id);

  const resetUrl = `${APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;

  const { subject, text, html } = passwordResetEmailTemplate({
    username: user.username,
    link: resetUrl,
    expiresAt,
  });

  await sendMail({
    to: user.email,
    subject,
    text,
    html,
  });

  return { ok: true };
}

/**
 * 2) User posts new password with the token.
 */
export async function resetPasswordWithToken(token, newPasswordRaw) {
  const newPassword = String(newPasswordRaw || '');
  if (!token) throw Boom.badRequest('token required');
  if (newPassword.length < 8) throw Boom.badRequest('password too short');

  const consumed = await consumeResetToken(token);
  if (!consumed.ok) {
    const map = {
      invalid: Boom.badRequest('invalid token'),
      expired: Boom.badRequest('token expired'),
      used: Boom.badRequest('token already used')
    };
    throw map[consumed.reason] || Boom.badRequest('invalid token');
  }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.user.update({
    where: { id: consumed.userId },
    data: { passwordHash: hash },
  });

  return { ok: true };
}
