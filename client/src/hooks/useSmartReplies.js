import { useEffect, useRef, useState } from 'react';
import axiosClient from '../api/axiosClient';

export function useSmartReplies({
  messages,
  currentUserId,
  enabled = false,
  locale,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const lastSeenMsgId = useRef(null);
  const inflight = useRef(false);

  useEffect(() => {
    if (!enabled || !Array.isArray(messages) || messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (!last || last.id === lastSeenMsgId.current) return;

    // Only trigger on inbound messages
    const inbound = last.sender?.id != null && String(last.sender.id) !== String(currentUserId);
    if (!inbound) {
      lastSeenMsgId.current = last.id;
      setSuggestions([]);
      return;
    }

    // Build last 3 decrypted turns (clamp text length a bit)
    const tail = messages.slice(-3).map((m) => ({
      role: m.sender?.id === currentUserId ? 'assistant' : 'user',
      content: String(m.decryptedContent || m.content || '').slice(0, 500),
    }));

    let cancelled = false;
    (async () => {
      if (inflight.current) return;
      inflight.current = true;
      try {
        const { data } = await axiosClient.post(
          '/ai/suggest-replies',
          {
            messages: tail,
            locale,
            filterProfanity: false,
          },
          { timeout: 6000 }
        );
        if (!cancelled) {
          setSuggestions((data?.suggestions || []).slice(0, 3));
          lastSeenMsgId.current = last.id;
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        inflight.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [messages, currentUserId, enabled, locale]);

  return { suggestions, clear: () => setSuggestions([]) };
}
