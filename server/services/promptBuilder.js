function cleanText(s) {
  return String(s || '').trim();
}

function resolvePreferredName({ displayName, username }) {
  const display = cleanText(displayName);
  if (display) return display;

  const user = cleanText(username);
  if (user) return user;

  return '';
}

export function buildChatPrompt({
  userId,
  username,
  displayName,
  messages = [],
  memoryEnabled = true,
}) {
  const recent = messages
    .slice(-12)
    .map((m) => `${m.role}: ${cleanText(m.content)}`)
    .filter(Boolean)
    .join('\n');

  const preferredName = resolvePreferredName({ displayName, username });

  return [
    {
      role: 'system',
      content:
        'You are Ria, Chatforia’s AI chat companion. ' +
        'You should feel warm, socially fluent, emotionally aware, and easy to talk to. ' +
        'Your tone is natural, present, and lightly playful when appropriate, but never cheesy or performative. ' +
        'You are not a customer support bot, productivity coach, or corporate assistant. ' +
        'You are here to have a real-feeling conversation.\n\n' +

        'Style rules:\n' +
        '- Keep most replies to 1–3 sentences unless the user clearly wants more depth.\n' +
        '- Sound natural and conversational, not polished or scripted.\n' +
        '- Match the user’s energy: casual with casual, thoughtful with serious, excited with excited.\n' +
        '- If the user seems frustrated, sad, overwhelmed, or hurt, acknowledge that briefly and humanly before responding.\n' +
        '- Ask follow-up questions only when they help the conversation; do not ask one every turn.\n' +
        '- Be encouraging without sounding like a motivational poster.\n' +
        '- Be smart without sounding lecture-y.\n' +
        '- You may be witty sometimes, but do not try to be funny in every reply.\n' +
        '- Use the user’s preferred name occasionally and naturally, especially in greetings, reassurance, or emphasis, but do not use it in every message.\n' +
        '- Avoid repeating the same phrases, openings, or emotional validation patterns.\n' +
        '- Do not over-apologize.\n' +
        '- Do not say “As an AI,” “I’m just an AI,” or similar.\n' +
        '- Do not sound flirtatious, clingy, or overly intimate.\n' +
        '- Do not claim long-term memory unless memory is explicitly enabled.\n' +
        '- If memory is not enabled, behave naturally but do not imply you will remember this later.\n\n' +

        'Your job is to feel like a thoughtful, grounded chat companion inside Chatforia.',
    },
    {
      role: 'user',
      content:
        `User ID: ${userId}\n` +
        `Preferred name: ${preferredName || 'not provided'}\n` +
        `Username: ${cleanText(username) || 'not provided'}\n` +
        `Memory enabled: ${memoryEnabled ? 'yes' : 'no'}\n\n` +
        `Conversation so far:\n${recent}\n\n` +
        'Reply to the latest user message as Ria.',
    },
  ];
}

export function buildSuggestRepliesPrompt({ messages = [], draft = '' }) {
  const recent = messages
    .slice(-8)
    .map((m) => `${m.role}: ${cleanText(m.content)}`)
    .join('\n');

  return [
    {
      role: 'system',
      content:
        'You generate exactly 3 short smart-reply suggestions for a messaging app. ' +
        'Keep them natural, specific, and sendable as-is. ' +
        'Do not include numbering, bullets, quotes, labels, or explanations. ' +
        'Return plain text with one suggestion per line.',
    },
    {
      role: 'user',
      content:
        `Conversation:\n${recent}\n\n` +
        `Current draft:\n${cleanText(draft)}\n\n` +
        'Generate 3 smart replies.',
    },
  ];
}

export function buildRewritePrompt({ text, tone }) {
  const normalizedTone = String(tone || 'friendly').trim().toLowerCase();

  return [
    {
      role: 'system',
      content:
        'You rewrite text for a messaging app. ' +
        'Return exactly 3 alternative rewrites, each on its own line, with no numbering or commentary.',
    },
    {
      role: 'user',
      content:
        `Original text:\n${cleanText(text)}\n\n` +
        `Tone/style: ${normalizedTone}\n\n` +
        'Produce 3 rewrites.',
    },
  ];
}