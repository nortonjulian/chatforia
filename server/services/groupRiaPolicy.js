/**
 * Group Ria invocation contract.
 * Only a deliberate @Ria mention or leading /ask command can trigger group AI.
 * Historical @ForiaBot remains an invocation alias, not public-facing branding.
 * No plain conversation messages qualify.
 */
export function extractGroupRiaPrompt(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;

  const command = text.match(/^\/ask(?:\s+|$)([\s\S]*)$/i);
  if (command) {
    const prompt = command[1].trim();
    return prompt || null;
  }

  const mention = /(^|\s)@(?:ria|foriabot)(?=$|[\s,:!?])/i;
  if (!mention.test(text)) return null;
  const prompt = text.replace(mention, '$1').trim().replace(/^[,:!?]+\s*/, '').replace(/\s+,/g, ',');
  return prompt || null;
}

/**
 * Reject supplied encrypted indicators BEFORE invoking the AI.
 * The caller must ALSO re-fetch the persisted message's ciphertext, keys,
 * and payloads (not present in the createMessageService result).
 */
export function hasEncryptedMessageIndicators(message) {
  if (!message || typeof message !== 'object') return true;
  return Boolean(
    message.contentCiphertext ||
    message.encryptedPayloads ||
    message.encryptedKeys ||
    (Array.isArray(message.keys) && message.keys.length > 0) ||
    (Array.isArray(message.payloads) && message.payloads.length > 0)
  );
}
