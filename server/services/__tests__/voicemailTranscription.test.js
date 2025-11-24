/**
 * @file Jest tests for voicemailTranscription.js
 *
 * These tests focus on the exported public function:
 *   - enqueueVoicemailTranscription(voicemailId)
 *
 * We mock:
 *   - prisma.voicemail
 *   - OpenAI
 *   - logger
 *   - global.fetch
 */

import path from 'path';

jest.mock('../utils/prismaClient.js', () => {
  // prisma is a default export in your utils
  return {
    default: {
      voicemail: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    },
  };
});

jest.mock('../utils/logger.js', () => {
  // logger is a default export with .info/.warn/.error
  return {
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// Mock OpenAI client
const mockCreateTranscription = jest.fn();

jest.mock('openai', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      audio: {
        transcriptions: {
          create: mockCreateTranscription,
        },
      },
    })),
  };
});

// We'll inject a mock global.fetch in each test
global.fetch = jest.fn();

const prisma = (await import('../utils/prismaClient.js')).default;
const logger = (await import('../utils/logger.js')).default;

const { enqueueVoicemailTranscription } = await import('../voicemailTranscription.js');

describe('voicemailTranscription.enqueueVoicemailTranscription', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV }; // shallow clone
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('marks voicemail FAILED when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;

    const voicemailId = 'vm-no-key';

    await enqueueVoicemailTranscription(voicemailId);

    expect(prisma.voicemail.update).toHaveBeenCalledWith({
      where: { id: voicemailId },
      data: { transcriptStatus: 'FAILED' },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateTranscription).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test('returns early when voicemail is not found', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    prisma.voicemail.findUnique.mockResolvedValueOnce(null);

    const voicemailId = 'vm-missing';
    await enqueueVoicemailTranscription(voicemailId);

    expect(prisma.voicemail.findUnique).toHaveBeenCalledWith({
      where: { id: voicemailId },
      include: {
        user: {
          select: {
            id: true,
            plan: true,
          },
        },
      },
    });

    // No update, no fetch, no OpenAI transcription
    expect(prisma.voicemail.update).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateTranscription).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test('skips transcription for FREE plan users and marks FAILED', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    prisma.voicemail.findUnique.mockResolvedValueOnce({
      id: 'vm-free',
      audioUrl: 'https://example.com/audio.mp3',
      user: { id: 123, plan: 'FREE' },
    });

    await enqueueVoicemailTranscription('vm-free');

    expect(prisma.voicemail.update).toHaveBeenCalledWith({
      where: { id: 'vm-free' },
      data: { transcriptStatus: 'FAILED' },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateTranscription).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  test('happy path: fetches audio, calls OpenAI, saves COMPLETE transcript', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const voicemailId = 'vm-ok';

    prisma.voicemail.findUnique.mockResolvedValueOnce({
      id: voicemailId,
      audioUrl: 'https://example.com/audio.mp3',
      user: { id: 999, plan: 'PREMIUM' },
    });

    // Mock fetch -> ok + arrayBuffer
    const fakeBuffer = Buffer.from('abc');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => fakeBuffer.buffer,
    });

    // OpenAI transcription result
    mockCreateTranscription.mockResolvedValueOnce({
      text: 'Hello from voicemail',
    });

    await enqueueVoicemailTranscription(voicemailId);

    expect(global.fetch).toHaveBeenCalledWith('https://example.com/audio.mp3');

    // Should write transcript + COMPLETE status
    expect(prisma.voicemail.update).toHaveBeenCalledWith({
      where: { id: voicemailId },
      data: {
        transcript: 'Hello from voicemail',
        transcriptStatus: 'COMPLETE',
      },
    });

    expect(mockCreateTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-transcribe',
        file: expect.anything(), // we don't assert exact stream path here
      })
    );

    expect(logger.info).toHaveBeenCalledWith(
      { voicemailId, userId: 999 },
      'Voicemail transcription completed'
    );
  });

  test('marks FAILED when fetch or transcription throws', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const voicemailId = 'vm-error';

    prisma.voicemail.findUnique.mockResolvedValueOnce({
      id: voicemailId,
      audioUrl: 'https://example.com/audio.mp3',
      user: { id: 42, plan: 'PREMIUM' },
    });

    // Simulate fetch error
    global.fetch.mockRejectedValueOnce(new Error('network fail'));

    await enqueueVoicemailTranscription(voicemailId);

    expect(prisma.voicemail.update).toHaveBeenCalledWith({
      where: { id: voicemailId },
      data: {
        transcriptStatus: 'FAILED',
      },
    });

    expect(logger.error).toHaveBeenCalled();
  });
});
