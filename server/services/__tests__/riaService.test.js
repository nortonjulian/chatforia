import OpenAI from 'openai';
import {
  suggestReplies,
  rewriteText,
  chatWithRia,
} from './riaService.js';
import {
  buildSuggestRepliesPrompt,
  buildRewritePrompt,
  buildChatPrompt,
} from './promptBuilder.js';

jest.mock('openai');
jest.mock('./promptBuilder.js', () => ({
  buildSuggestRepliesPrompt: jest.fn(),
  buildRewritePrompt: jest.fn(),
  buildChatPrompt: jest.fn(),
}));

describe('riaService', () => {
  let createMock;

  beforeEach(() => {
    jest.clearAllMocks();

    createMock = jest.fn();

    OpenAI.mockImplementation(() => ({
      chat: {
        completions: {
          create: createMock,
        },
      },
    }));
  });

  describe('suggestReplies', () => {
    it('builds the prompt, calls OpenAI, and returns up to 3 suggestions', async () => {
      const prompt = [{ role: 'user', content: 'prompt' }];
      buildSuggestRepliesPrompt.mockReturnValue(prompt);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Sure\nSounds good\nLet me think',
            },
          },
        ],
      });

      const result = await suggestReplies({
        messages: [{ role: 'user', content: 'hey' }],
        draft: 'maybe later',
      });

      expect(buildSuggestRepliesPrompt).toHaveBeenCalledWith({
        messages: [{ role: 'user', content: 'hey' }],
        draft: 'maybe later',
      });

      expect(createMock).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.7,
        max_tokens: 120,
      });

      expect(result).toEqual({
        suggestions: ['Sure', 'Sounds good', 'Let me think'],
      });
    });

    it('strips bullets and numbering from suggestions', async () => {
      buildSuggestRepliesPrompt.mockReturnValue([{ role: 'user', content: 'prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: '1. Yes\n- No worries\n* I got you',
            },
          },
        ],
      });

      const result = await suggestReplies({
        messages: [],
        draft: '',
      });

      expect(result).toEqual({
        suggestions: ['Yes', 'No worries', 'I got you'],
      });
    });

    it('returns only the first 3 non-empty suggestions', async () => {
      buildSuggestRepliesPrompt.mockReturnValue([{ role: 'user', content: 'prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: '\nFirst\n\nSecond\nThird\nFourth\n',
            },
          },
        ],
      });

      const result = await suggestReplies({
        messages: [],
        draft: '',
      });

      expect(result).toEqual({
        suggestions: ['First', 'Second', 'Third'],
      });
    });

    it('masks profanity in suggestions when filterProfanity is true', async () => {
      buildSuggestRepliesPrompt.mockReturnValue([{ role: 'user', content: 'prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'shit\nfuck that\nall good',
            },
          },
        ],
      });

      const result = await suggestReplies({
        messages: [],
        draft: '',
        filterProfanity: true,
      });

      expect(result).toEqual({
        suggestions: ['s***', 'f*** that', 'all good'],
      });
    });

    it('does not mask profanity when filterProfanity is false', async () => {
      buildSuggestRepliesPrompt.mockReturnValue([{ role: 'user', content: 'prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'shit\nfuck that\nall good',
            },
          },
        ],
      });

      const result = await suggestReplies({
        messages: [],
        draft: '',
        filterProfanity: false,
      });

      expect(result).toEqual({
        suggestions: ['shit', 'fuck that', 'all good'],
      });
    });

    it('returns an empty suggestions array when model content is missing', async () => {
      buildSuggestRepliesPrompt.mockReturnValue([{ role: 'user', content: 'prompt' }]);

      createMock.mockResolvedValue({
        choices: [{}],
      });

      const result = await suggestReplies({
        messages: [],
        draft: '',
      });

      expect(result).toEqual({
        suggestions: [],
      });
    });
  });

  describe('rewriteText', () => {
    it('builds the prompt, calls OpenAI, and returns up to 3 rewrites', async () => {
      const prompt = [{ role: 'user', content: 'rewrite prompt' }];
      buildRewritePrompt.mockReturnValue(prompt);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Option one\nOption two\nOption three',
            },
          },
        ],
      });

      const result = await rewriteText({
        text: 'hello',
        tone: 'friendly',
      });

      expect(buildRewritePrompt).toHaveBeenCalledWith({
        text: 'hello',
        tone: 'friendly',
      });

      expect(createMock).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.7,
        max_tokens: 180,
      });

      expect(result).toEqual({
        rewrites: ['Option one', 'Option two', 'Option three'],
      });
    });

    it('strips bullets and numbering from rewrites', async () => {
      buildRewritePrompt.mockReturnValue([{ role: 'user', content: 'rewrite prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: '1) First rewrite\n2) Second rewrite\n- Third rewrite',
            },
          },
        ],
      });

      const result = await rewriteText({
        text: 'hello',
        tone: 'casual',
      });

      expect(result).toEqual({
        rewrites: ['First rewrite', 'Second rewrite', 'Third rewrite'],
      });
    });

    it('masks profanity in rewrites when filterProfanity is true', async () => {
      buildRewritePrompt.mockReturnValue([{ role: 'user', content: 'rewrite prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'shit\nfuck this\nclean line',
            },
          },
        ],
      });

      const result = await rewriteText({
        text: 'hello',
        tone: 'casual',
        filterProfanity: true,
      });

      expect(result).toEqual({
        rewrites: ['s***', 'f*** this', 'clean line'],
      });
    });

    it('returns an empty rewrites array when model content is blank', async () => {
      buildRewritePrompt.mockReturnValue([{ role: 'user', content: 'rewrite prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: '',
            },
          },
        ],
      });

      const result = await rewriteText({
        text: 'hello',
        tone: 'casual',
      });

      expect(result).toEqual({
        rewrites: [],
      });
    });
  });

  describe('chatWithRia', () => {
    it('builds the prompt, calls OpenAI, and returns a trimmed reply', async () => {
      const prompt = [{ role: 'user', content: 'chat prompt' }];
      buildChatPrompt.mockReturnValue(prompt);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: '  Hey, I’m here for you.  ',
            },
          },
        ],
      });

      const input = {
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [{ role: 'user', content: 'hi' }],
        memoryEnabled: true,
      };

      const result = await chatWithRia(input);

      expect(buildChatPrompt).toHaveBeenCalledWith({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [{ role: 'user', content: 'hi' }],
        memoryEnabled: true,
      });

      expect(createMock).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.7,
        max_tokens: 220,
      });

      expect(result).toEqual({
        reply: 'Hey, I’m here for you.',
      });
    });

    it('passes default memoryEnabled=true to buildChatPrompt when omitted', async () => {
      buildChatPrompt.mockReturnValue([{ role: 'user', content: 'chat prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Hello there',
            },
          },
        ],
      });

      await chatWithRia({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [],
      });

      expect(buildChatPrompt).toHaveBeenCalledWith({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [],
        memoryEnabled: true,
      });
    });

    it('masks profanity in the reply when filterProfanity is true', async () => {
      buildChatPrompt.mockReturnValue([{ role: 'user', content: 'chat prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'shit, that sounds hard. fuck this situation.',
            },
          },
        ],
      });

      const result = await chatWithRia({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [],
        filterProfanity: true,
      });

      expect(result).toEqual({
        reply: 's***, that sounds hard. f*** this situation.',
      });
    });

    it('does not mask profanity when filterProfanity is false', async () => {
      buildChatPrompt.mockReturnValue([{ role: 'user', content: 'chat prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'shit, that sounds hard. fuck this situation.',
            },
          },
        ],
      });

      const result = await chatWithRia({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [],
        filterProfanity: false,
      });

      expect(result).toEqual({
        reply: 'shit, that sounds hard. fuck this situation.',
      });
    });

    it('falls back to the default reply when model content is blank after trimming', async () => {
      buildChatPrompt.mockReturnValue([{ role: 'user', content: 'chat prompt' }]);

      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: '   ',
            },
          },
        ],
      });

      const result = await chatWithRia({
        userId: '123',
        username: 'julian',
        displayName: 'Julian',
        messages: [],
      });

      expect(result).toEqual({
        reply: "I'm here with you.",
      });
    });

    it('propagates OpenAI errors', async () => {
      buildChatPrompt.mockReturnValue([{ role: 'user', content: 'chat prompt' }]);

      createMock.mockRejectedValue(new Error('OpenAI failed'));

      await expect(
        chatWithRia({
          userId: '123',
          username: 'julian',
          displayName: 'Julian',
          messages: [],
        })
      ).rejects.toThrow('OpenAI failed');
    });
  });
});