import OpenAI from 'openai';

// Group-only provider: never reads room history, personal Ria memory, or DMs.
// Use the API key only after the caller has verified explicit consent.
export async function generateGroupRiaReply(prompt) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) return null;
  const client = new OpenAI({ apiKey: key, timeout: 15000, maxRetries: 0 });
  const result = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are Ria, a friendly and concise assistant invited into a Chatforia group chat. Answer only the explicit request; do not assume access to prior chat history.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 220,
  });
  return String(result.choices?.[0]?.message?.content || '').trim().slice(0, 2000) || null;
}
