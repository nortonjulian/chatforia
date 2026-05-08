import { jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prismaPath = path.resolve(__dirname, '../../utils/prismaClient.js');
const loggerPath = path.resolve(__dirname, '../../utils/logger.js');
const socketBusPath = path.resolve(__dirname, '../socketBus.js');
const servicePath = path.resolve(__dirname, '../voicemailTranscription.js');

const mockCreateTranscription = jest.fn();

const prismaMock = {
  voicemail: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const emitToUserMock = jest.fn();

const writeFileMock = jest.fn((_file, _data, cb) => cb(null));
const unlinkMock = jest.fn((_file, cb) => cb(null));
const createReadStreamMock = jest.fn(() => ({
  mockStream: true,
}));

async function loadService({ openaiKey } = {}) {
  jest.resetModules();
  jest.clearAllMocks();

  prismaMock.voicemail.findUnique.mockReset();
  prismaMock.voicemail.update.mockReset();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  emitToUserMock.mockReset();
  mockCreateTranscription.mockReset();
  writeFileMock.mockClear();
  unlinkMock.mockClear();
  createReadStreamMock.mockClear();

  if (openaiKey) {
    process.env.OPENAI_API_KEY = openaiKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }

  jest.unstable_mockModule(prismaPath, () => ({
    __esModule: true,
    default: prismaMock,
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    __esModule: true,
    default: loggerMock,
  }));

  jest.unstable_mockModule(socketBusPath, () => ({
    __esModule: true,
    emitToUser: emitToUserMock,
  }));

  jest.unstable_mockModule('fs', () => ({
    __esModule: true,
    default: {
      writeFile: writeFileMock,
      unlink: unlinkMock,
      createReadStream: createReadStreamMock,
    },
    writeFile: writeFileMock,
    unlink: unlinkMock,
    createReadStream: createReadStreamMock,
  }));

  jest.unstable_mockModule('openai', () => ({
    __esModule: true,
    default: jest.fn(() => ({
      audio: {
        transcriptions: {
          create: mockCreateTranscription,
        },
      },
    })),
  }));

  global.fetch = jest.fn();

  return import(servicePath);
}

describe('voicemailTranscription.enqueueVoicemailTranscription', () => {
  const ORIGINAL_ENV = process.env;

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('marks voicemail FAILED when OPENAI_API_KEY is missing', async () => {
    const { enqueueVoicemailTranscription } = await loadService();

    prismaMock.voicemail.update.mockResolvedValueOnce({
      id: 'vm-no-key',
      userId: 123,
      transcript: null,
      transcriptStatus: 'FAILED',
    });

    await enqueueVoicemailTranscription('vm-no-key');

    expect(prismaMock.voicemail.update).toHaveBeenCalledWith({
      where: { id: 'vm-no-key' },
      data: { transcriptStatus: 'FAILED' },
      select: {
        id: true,
        userId: true,
        transcript: true,
        transcriptStatus: true,
      },
    });

    expect(emitToUserMock).toHaveBeenCalledWith(123, 'voicemail:updated', {
      id: 'vm-no-key',
      transcript: null,
      transcriptStatus: 'FAILED',
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateTranscription).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  test('returns early when voicemail is not found', async () => {
    const { enqueueVoicemailTranscription } = await loadService({
      openaiKey: 'test-key',
    });

    prismaMock.voicemail.findUnique.mockResolvedValueOnce(null);

    await enqueueVoicemailTranscription('vm-missing');

    expect(prismaMock.voicemail.findUnique).toHaveBeenCalledWith({
      where: { id: 'vm-missing' },
      include: {
        user: {
          select: {
            id: true,
            plan: true,
          },
        },
      },
    });

    expect(prismaMock.voicemail.update).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateTranscription).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  test('skips transcription for FREE plan users and marks FAILED', async () => {
    const { enqueueVoicemailTranscription } = await loadService({
      openaiKey: 'test-key',
    });

    prismaMock.voicemail.findUnique.mockResolvedValueOnce({
      id: 'vm-free',
      audioUrl: 'https://example.com/audio.mp3',
      userId: 123,
      user: { id: 123, plan: 'FREE' },
    });

    prismaMock.voicemail.update.mockResolvedValueOnce({
      id: 'vm-free',
      userId: 123,
      transcript: null,
      transcriptStatus: 'FAILED',
    });

    await enqueueVoicemailTranscription('vm-free');

    expect(prismaMock.voicemail.update).toHaveBeenCalledWith({
      where: { id: 'vm-free' },
      data: { transcriptStatus: 'FAILED' },
      select: {
        id: true,
        userId: true,
        transcript: true,
        transcriptStatus: true,
      },
    });

    expect(emitToUserMock).toHaveBeenCalledWith(123, 'voicemail:updated', {
      id: 'vm-free',
      transcript: null,
      transcriptStatus: 'FAILED',
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateTranscription).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalled();
  });

  test('happy path: fetches audio, calls OpenAI, saves COMPLETE transcript', async () => {
    const { enqueueVoicemailTranscription } = await loadService({
      openaiKey: 'test-key',
    });

    prismaMock.voicemail.findUnique.mockResolvedValueOnce({
      id: 'vm-ok',
      audioUrl: 'https://example.com/audio.mp3',
      userId: 999,
      user: { id: 999, plan: 'PREMIUM' },
    });

    prismaMock.voicemail.update.mockResolvedValueOnce({
      id: 'vm-ok',
      userId: 999,
      transcript: 'Hello from voicemail',
      transcriptStatus: 'COMPLETE',
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => Buffer.from('abc').buffer,
    });

    mockCreateTranscription.mockResolvedValueOnce({
      text: 'Hello from voicemail',
    });

    await enqueueVoicemailTranscription('vm-ok');

    expect(global.fetch).toHaveBeenCalledWith('https://example.com/audio.mp3');

    expect(createReadStreamMock).toHaveBeenCalled();

    expect(mockCreateTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-transcribe',
        file: expect.anything(),
      })
    );

    expect(prismaMock.voicemail.update).toHaveBeenCalledWith({
      where: { id: 'vm-ok' },
      data: {
        transcript: 'Hello from voicemail',
        transcriptStatus: 'COMPLETE',
      },
      select: {
        id: true,
        userId: true,
        transcript: true,
        transcriptStatus: true,
      },
    });

    expect(emitToUserMock).toHaveBeenCalledWith(999, 'voicemail:updated', {
      id: 'vm-ok',
      transcript: 'Hello from voicemail',
      transcriptStatus: 'COMPLETE',
    });

    expect(loggerMock.info).toHaveBeenCalledWith(
      { voicemailId: 'vm-ok', userId: 999 },
      'Voicemail transcription completed'
    );
  });

  test('marks FAILED when fetch or transcription throws', async () => {
    const { enqueueVoicemailTranscription } = await loadService({
      openaiKey: 'test-key',
    });

    prismaMock.voicemail.findUnique.mockResolvedValueOnce({
      id: 'vm-error',
      audioUrl: 'https://example.com/audio.mp3',
      userId: 42,
      user: { id: 42, plan: 'PREMIUM' },
    });

    prismaMock.voicemail.update.mockResolvedValueOnce({
      id: 'vm-error',
      userId: 42,
      transcript: null,
      transcriptStatus: 'FAILED',
    });

    global.fetch.mockRejectedValueOnce(new Error('network fail'));

    await enqueueVoicemailTranscription('vm-error');

    expect(prismaMock.voicemail.update).toHaveBeenCalledWith({
      where: { id: 'vm-error' },
      data: {
        transcriptStatus: 'FAILED',
      },
      select: {
        id: true,
        userId: true,
        transcript: true,
        transcriptStatus: true,
      },
    });

    expect(emitToUserMock).toHaveBeenCalledWith(42, 'voicemail:updated', {
      id: 'vm-error',
      transcript: null,
      transcriptStatus: 'FAILED',
    });

    expect(loggerMock.error).toHaveBeenCalled();
  });
});