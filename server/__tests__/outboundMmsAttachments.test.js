import { jest } from '@jest/globals';
import {
  authorizeOutboundMmsAttachments,
  MAX_MMS_ATTACHMENT_BYTES,
} from '../services/outboundMmsAttachments.js';

const key = 'uploads/u7/2026/10/29/picture.jpg';
const base = 'https://media.chatforia.com';

function setup(overrides = {}) {
  const prisma = {
    upload: {
      findFirst: jest.fn().mockResolvedValue({
        key,
        mimeType: 'image/jpeg',
        size: 1234,
        ...overrides,
      }),
    },
  };

  const presignGet = jest.fn().mockResolvedValue(
    'https://storage.example.test/signed-picture'
  );

  return {
    prisma,
    presignGet,
    userId: 7,
    mediaRefs: [key],
    publicBase: base,
  };
}

describe('outbound MMS attachment authorization', () => {
  test('authorizes owned JPEG and signs a delivery URL', async () => {
    const args = setup();
    const result = await authorizeOutboundMmsAttachments(args);

    expect(args.prisma.upload.findFirst).toHaveBeenCalledWith({
      where: { ownerId: 7, key, driver: 's3' },
      select: { key: true, mimeType: true, size: true },
    });

    expect(args.presignGet).toHaveBeenCalledWith({
      key,
      expiresSec: 3600,
      responseContentType: 'image/jpeg',
    });

    expect(result.providerUrls).toEqual([
      'https://storage.example.test/signed-picture',
    ]);
    expect(result.storedUrls).toEqual([key]);
  });

  test('accepts a canonical URL under the configured media base', async () => {
    const args = setup();
    args.mediaRefs = [`${base}/${key}`];

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).resolves.toMatchObject({
      storedUrls: [key],
    });
  });

  test('rejects an upload not owned by the sender', async () => {
    const args = setup();
    args.prisma.upload.findFirst.mockResolvedValue(null);

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).rejects.toThrow('MMS attachment not owned by sender');

    expect(args.presignGet).not.toHaveBeenCalled();
  });

  test('rejects another user storage key', async () => {
    const args = setup();
    args.mediaRefs = ['uploads/u8/2026/10/29/picture.jpg'];

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).rejects.toThrow('Invalid MMS storage key');

    expect(args.presignGet).not.toHaveBeenCalled();
  });

  test('rejects an unsupported file type', async () => {
    const args = setup({ mimeType: 'application/pdf' });

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).rejects.toThrow('Unsupported MMS attachment type or size');
  });

  test('rejects an oversized attachment', async () => {
    const args = setup({
      size: MAX_MMS_ATTACHMENT_BYTES + 1,
    });

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).rejects.toThrow('Unsupported MMS attachment type or size');
  });

  test('rejects duplicate attachments', async () => {
    const args = setup();
    args.mediaRefs = [key, key];

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).rejects.toThrow('Duplicate MMS attachment');

    expect(args.presignGet).not.toHaveBeenCalled();
  });

  test('rejects an external media URL', async () => {
    const args = setup();
    args.mediaRefs = ['https://external.example/picture.jpg'];

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).rejects.toThrow('Unsupported MMS media URL');
  });

  test('rejects encoded path separators', async () => {
    const args = setup();
    args.mediaRefs = [
      `${base}/uploads/u7/2026/10/29%2Fpicture.jpg`,
    ];

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).rejects.toThrow('Invalid MMS storage key');

    expect(args.presignGet).not.toHaveBeenCalled();
  });

  test('rejects malformed URL encoding', async () => {
    const args = setup();
    args.mediaRefs = [
      `${base}/uploads/u7/2026/10/29/%ZZ.jpg`,
    ];

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).rejects.toThrow('Invalid MMS storage key');

    expect(args.presignGet).not.toHaveBeenCalled();
  });

  test('rejects an empty list', async () => {
    const args = setup();
    args.mediaRefs = [];

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).rejects.toThrow('Invalid MMS attachments');
  });

  test('accepts a canonical key without a public media base', async () => {
    const args = setup();
    args.publicBase = undefined;

    await expect(
      authorizeOutboundMmsAttachments(args)
    ).resolves.toMatchObject({ storedUrls: [key] });
  });
});
