import OpenAI from 'openai';
import {
  buildSuggestRepliesPrompt,
  buildRewritePrompt,
  buildChatPrompt,
} from './promptBuilder.js';

function getOpenAIClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();

  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY is missing');
    err.code = 'OPENAI_NOT_CONFIGURED';
    throw err;
  }

  return new OpenAI({ apiKey });
}

function parseLineList(text, max = 3) {
  return String(text || '')
    .split('\n')
    .map((s) => s.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function applyProfanityMask(text) {
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
  const client = getOpenAIClient();

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
  });

  return response.choices[0]?.message?.content || '';
}

export async function suggestReplies({
  messages,
  draft,
  filterProfanity = false,
}) {
  const prompt = buildSuggestRepliesPrompt({ messages, draft });
  const text = await chatText(prompt, 120);
  const suggestions = maybeMaskList(parseLineList(text, 3), filterProfanity);

  return {
    suggestions: suggestions.slice(0, 3),
  };
}

export async function rewriteText({
  text,
  tone,
  filterProfanity = false,
}) {
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