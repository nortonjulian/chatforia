import {
  buildChatPrompt,
  buildSuggestRepliesPrompt,
  buildRewritePrompt,
} from './promptBuilder';

describe('promptBuilder', () => {
  describe('buildChatPrompt', () => {
    it('returns the expected prompt structure', () => {
      const result = buildChatPrompt({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [{ role: 'user', content: 'Hey there' }],
        memoryEnabled: true,
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('You are Ria, Chatforia’s AI chat companion.'),
        })
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Reply to the latest user message as Ria.'),
        })
      );
    });

    it('uses displayName as preferred name when provided', () => {
      const result = buildChatPrompt({
        userId: '123',
        username: 'julian_user',
        displayName: 'Julian',
        messages: [],
        memoryEnabled: true,
      });

      expect(result[1].content).toContain('Preferred name: Julian');
    });

    it('falls back to username when displayName is blank', () => {
      const result = buildChatPrompt({
        userId: '123',
        username: 'julian_user',
        displayName: '   ',
        messages: [],
        memoryEnabled: true,
      });

      expect(result[1].content).toContain('Preferred name: julian_user');
    });

    it('uses "not provided" when both displayName and username are missing/blank', () => {
      const result = buildChatPrompt({
        userId: '123',
        username: '   ',
        displayName: '',
        messages: [],
        memoryEnabled: true,
      });

      expect(result[1].content).toContain('Preferred name: not provided');
      expect(result[1].content).toContain('Username: not provided');
    });

    it('trims username, displayName, and message content', () => {
      const result = buildChatPrompt({
        userId: '123',
        username: '  julian  ',
        displayName: '  Julian Norton  ',
        messages: [
          { role: 'user', content: '  hello  ' },
          { role: 'assistant', content: '  hi there  ' },
        ],
        memoryEnabled: true,
      });

      expect(result[1].content).toContain('Preferred name: Julian Norton');
      expect(result[1].content).toContain('Username: julian');
      expect(result[1].content).toContain('user: hello');
      expect(result[1].content).toContain('assistant: hi there');
    });

    it('includes only the last 12 messages', () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message-${i + 1}`,
      }));

      const result = buildChatPrompt({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages,
        memoryEnabled: true,
      });

      const content = result[1].content;

      expect(content).not.toContain('message-1');
      expect(content).not.toContain('message-2');
      expect(content).not.toContain('message-3');
      expect(content).toContain('message-4');
      expect(content).toContain('message-15');
    });

    it('filters out messages with empty cleaned content', () => {
      const result = buildChatPrompt({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [
          { role: 'user', content: '   ' },
          { role: 'assistant', content: null },
          { role: 'user', content: 'hello' },
        ],
        memoryEnabled: true,
      });

      const content = result[1].content;

      expect(content).toContain('user: hello');
      expect(content).not.toContain('user:    ');
      expect(content).not.toContain('assistant:');
    });

    it('shows memory enabled as yes when true', () => {
      const result = buildChatPrompt({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [],
        memoryEnabled: true,
      });

      expect(result[1].content).toContain('Memory enabled: yes');
    });

    it('shows memory enabled as no when false', () => {
      const result = buildChatPrompt({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [],
        memoryEnabled: false,
      });

      expect(result[1].content).toContain('Memory enabled: no');
    });

    it('handles missing messages by defaulting to an empty array', () => {
      const result = buildChatPrompt({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
      });

      expect(result[1].content).toContain('Conversation so far:\n\n\nReply to the latest user message as Ria.');
    });
  });

  describe('buildSuggestRepliesPrompt', () => {
    it('returns the expected prompt structure', () => {
      const result = buildSuggestRepliesPrompt({
        messages: [{ role: 'user', content: 'Hey' }],
        draft: 'What should I say?',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('You generate exactly 3 short smart-reply suggestions'),
        })
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Generate 3 smart replies.'),
        })
      );
    });

    it('includes only the last 8 messages', () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `msg-${i + 1}`,
      }));

      const result = buildSuggestRepliesPrompt({
        messages,
        draft: 'draft here',
      });

      const content = result[1].content;

      expect(content).not.toContain('msg-1');
      expect(content).not.toContain('msg-2');
      expect(content).toContain('msg-3');
      expect(content).toContain('msg-10');
    });

    it('trims message content and draft', () => {
      const result = buildSuggestRepliesPrompt({
        messages: [
          { role: 'user', content: '  hello  ' },
          { role: 'assistant', content: '  hi  ' },
        ],
        draft: '  sounds good  ',
      });

      const content = result[1].content;

      expect(content).toContain('user: hello');
      expect(content).toContain('assistant: hi');
      expect(content).toContain('Current draft:\nsounds good');
    });

    it('handles empty or null draft safely', () => {
      const result = buildSuggestRepliesPrompt({
        messages: [{ role: 'user', content: 'hello' }],
        draft: null,
      });

      expect(result[1].content).toContain('Current draft:\n');
    });

    it('includes blank cleaned messages as empty lines instead of filtering them out', () => {
      const result = buildSuggestRepliesPrompt({
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: '   ' },
          { role: 'user', content: 'bye' },
        ],
        draft: '',
      });

      const content = result[1].content;

      expect(content).toContain('user: hello');
      expect(content).toContain('assistant: ');
      expect(content).toContain('user: bye');
    });
  });

  describe('buildRewritePrompt', () => {
    it('returns the expected prompt structure', () => {
      const result = buildRewritePrompt({
        text: 'Hello there',
        tone: 'casual',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('You rewrite text for a messaging app.'),
        })
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Produce 3 rewrites.'),
        })
      );
    });

    it('normalizes tone to lowercase and trims whitespace', () => {
      const result = buildRewritePrompt({
        text: 'Hello there',
        tone: '  PROFESSIONAL  ',
      });

      expect(result[1].content).toContain('Tone/style: professional');
    });

    it('defaults tone to friendly when missing', () => {
      const result = buildRewritePrompt({
        text: 'Hello there',
      });

      expect(result[1].content).toContain('Tone/style: friendly');
    });

    it('trims the original text', () => {
      const result = buildRewritePrompt({
        text: '  Need this cleaned up  ',
        tone: 'friendly',
      });

      expect(result[1].content).toContain('Original text:\nNeed this cleaned up');
    });

    it('handles null or undefined text safely', () => {
      const result = buildRewritePrompt({
        text: null,
        tone: 'friendly',
      });

      expect(result[1].content).toContain('Original text:\n');
    });
  });
});