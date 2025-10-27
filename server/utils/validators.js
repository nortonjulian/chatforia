import { z } from 'zod';
import { normalizeE164 } from './phone.js';

export const SmsInviteSchema = z.object({
  phone: z
    .string()
    .min(3)
    .transform(normalizeE164)
    .refine(Boolean, 'Invalid phone'),
  message: z
    .string()
    .trim()
    .min(1)
    .max(480)
    .optional(), // keep SMS short; carriers dislike long links
  preferredProvider: z
    .enum(['telnyx', 'bandwidth'])
    .optional(),
});

export const EmailInviteSchema = z.object({
  to: z.union([
    z.string().email(),
    z.array(z.string().email()).min(1),
  ]),
  roomId: z.union([z.string(), z.number()]).optional(),
  subject: z.string().trim().max(120).optional(),
  html: z.string().optional(),
  text: z.string().optional(),
});
