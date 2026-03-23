import OpenAI from 'openai';
import {
  buildSuggestRepliesPrompt,
  buildRewritePrompt,
  buildChatPrompt,
} from './promptBuilder.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseLineList(text, max = 3) {
  return String(text || '')
    .split('\n')
    .map((s) => s.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function applyProfanityMask(text) {
  // Placeholder. Replace later with your real masker if you already have one.
  return String(text || '')
    .replace(/\bshit\b/gi, 's***')
    .replace(/\bfuck\b/gi, 'f***');
}

function maybeMaskList(items, filterProfanity) {
  if (!filterProfanity) return items;
  return items.map(applyProfanityMask);
}

function maybeMaskText(text, filterProfanity) {
  if (!filterProfanity) return text;
  return applyProfanityMask(text);
}

async function chatText(messages, maxTokens = 120) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
  });

  return response.choices[0]?.message?.content || '';
}

export async function suggestReplies({ messages, draft, filterProfanity = false }) {
  const prompt = buildSuggestRepliesPrompt({ messages, draft });
  const text = await chatText(prompt, 120);
  const suggestions = maybeMaskList(parseLineList(text, 3), filterProfanity);

  return {
    suggestions: suggestions.slice(0, 3),
  };
}

export async function rewriteText({ text, tone, filterProfanity = false }) {
  const prompt = buildRewritePrompt({ text, tone });
  const raw = await chatText(prompt, 180);
  const rewrites = maybeMaskList(parseLineList(raw, 3), filterProfanity);

  return {
    rewrites: rewrites.slice(0, 3),
  };
}

export async function chatWithRia({
  userId,
  username,
  displayName,
  messages,
  memoryEnabled = true,
  filterProfanity = false,
}) {
  const prompt = buildChatPrompt({
    userId,
    username,
    displayName,
    messages,
    memoryEnabled,
  });

  const raw = await chatText(prompt, 220);
  const reply = maybeMaskText(String(raw || '').trim(), filterProfanity);

  return {
    reply: reply || "I'm here with you.",
  };
}