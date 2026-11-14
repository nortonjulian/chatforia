import Boom from '@hapi/boom';
import { assertAndConsumeUsage, releaseUsage } from './planUsageService.js';

// UTF-8 bytes bound text token exposure without depending on a model tokenizer.
export const AI_MAX_PROMPT_BYTES = 32768;
export function assertAiPromptBudget(messages) {
  const bytes = messages.reduce((sum, message) =>
    sum + Buffer.byteLength(String(message.content || ''), 'utf8'), 0);
  if (bytes > AI_MAX_PROMPT_BYTES) {
    throw Boom.entityTooLarge('This AI request is too long. Shorten the text or conversation and try again.');
  }
}

export async function withRiaAllowance(user, operation) {
  // Pin the reservation month: a provider response can arrive after midnight.
  const date = new Date();
  await assertAndConsumeUsage({ userId: user.id, plan: user.plan, meter: 'riaActions', amount: 1, date });
  try {
    return await operation();
  } catch (error) {
    try { await releaseUsage({ userId: user.id, meter: 'riaActions', amount: 1, date }); }
    catch { console.error('Failed to release AI allowance'); }
    throw error;
  }
}
