import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  // restore env after each test
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

async function loadModuleWithOpenAIMock({ mockCreateImpl }) {
  jest.resetModules();

  // Set a fake API key so the OpenAI constructor in the module sees it
  process.env.OPENAI_API_KEY = 'test-key-123';

  // We'll capture how OpenAI() was constructed and how create() was called
  const openAIConstructorArgs = [];

  // Fake `client.chat.completions.create`
  const createMock = jest.fn(
    mockCreateImpl ||
      (async () => ({
        choices: [{ message: { content: 'hi there from ai' } }],
      }))
  );

  // Fake OpenAI client class that matches what generateAIResponse.js expects
  const FakeOpenAIClient = function FakeOpenAIClient(opts) {
    openAIConstructorArgs.push(opts);
    this.chat = {
      completions: {
        create: createMock,
      },
    };
  };

  // Mock `openai` package default export
  jest.unstable_mockModule('openai', () => ({
    default: FakeOpenAIClient,
  }));

  // Mock dotenv.config() to avoid touching real env/files
  jest.unstable_mockModule('dotenv', () => ({
    default: { config: jest.fn(() => {}) },
    config: jest.fn(() => {}),
  }));

  // Now import the module under test *after* mocks are in place
  const mod = await import('../../utils/generateAIResponse.js');

  return {
    mod,
    openAIConstructorArgs,
    createMock,
  };
}

describe('generateAIResponse', () => {
  test('calls OpenAI chat.completions.create with correct payload and returns model response text', async () => {
    const { mod, openAIConstructorArgs, createMock } =
      await loadModuleWithOpenAIMock({});

    const { generateAIResponse } = mod;

    const reply = await generateAIResponse('hello bot');

    // It should return the assistant content from choices[0].message.content
    expect(reply).toBe('hi there from ai');

    // It should have constructed OpenAI with our API key
    expect(openAIConstructorArgs).toHaveLength(1);
    expect(openAIConstructorArgs[0]).toEqual({
      apiKey: 'test-key-123',
    });

    // It should have called create() with the right payload
    expect(createMock).toHaveBeenCalledTimes(1);
    const callArg = createMock.mock.calls[0][0];

    // Check the shape/fields we're sending OpenAI
    expect(callArg.model).toBe('gpt-4o-mini');
    expect(callArg.max_tokens).toBe(100);

    // messages array structure:
    expect(Array.isArray(callArg.messages)).toBe(true);
    expect(callArg.messages[0]).toEqual({
      role: 'system',
      content: 'I am ForiaBot, a friendly chat companion.',
    });
    expect(callArg.messages[1]).toEqual({
      role: 'user',
      content: 'hello bot',
    });
  });

  test(`returns "I'm here to chat!" if choices[0].message.content is missing`, async () => {
    // mock create() to return an empty-ish response
    const missingContentCreate = async () => ({
      choices: [{ message: { content: undefined } }],
    });

    const { mod } = await loadModuleWithOpenAIMock({
      mockCreateImpl: missingContentCreate,
    });
    const { generateAIResponse } = mod;

    const reply = await generateAIResponse('yo?');
    expect(reply).toBe("I'm here to chat!");
  });

  test(`on error, logs to console.error and returns "Oops, I couldn't respond right now."`, async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // mock create() to throw
    const throwingCreate = async () => {
      throw new Error('network down');
    };

    const { mod } = await loadModuleWithOpenAIMock({
      mockCreateImpl: throwingCreate,
    });
    const { generateAIResponse } = mod;

    const reply = await generateAIResponse('are you there?');

    expect(reply).toBe("Oops, I couldn't respond right now.");

    // make sure we logged the error
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const [label, err] = consoleSpy.mock.calls[0];
    expect(label).toBe('AI Error:');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('network down');
  });
});
