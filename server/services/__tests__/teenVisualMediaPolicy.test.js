import { describe, expect, jest, test } from '@jest/globals';
import {
  isVisualAttachment, redactVisualMediaForViewer, roomHasTeen,
  visualMediaRestrictionError, isTeenMmsRestricted, redactTeenSmsMedia,
} from '../teenVisualMediaPolicy.js';

describe('temporary teen visual-media policy', () => {
  test('identifies visual kinds, MIME types, and disguised visual filenames', () => {
    for (const item of [
      { kind: 'GIF', url: 'opaque' },
      { kind: 'FILE', mimeType: 'image/heic', url: 'opaque' },
      { kind: 'AUDIO', mimeType: 'video/mp4', url: 'opaque' },
      { kind: 'FILE', mimeType: 'application/octet-stream', url: 'foo.jpg' },
      { kind: 'FILE', mimeType: 'application/octet-stream', url: 'opaque', thumbUrl: 'thumbs/one' },
    ]) expect(isVisualAttachment(item)).toBe(true);
    expect(isVisualAttachment({ kind: 'AUDIO', mimeType: 'audio/mpeg', url: 'voice.mp3' })).toBe(false);
    expect(isVisualAttachment({ kind: 'AUDIO', mimeType: 'audio/webm', url: 'voice.webm' })).toBe(false);
    expect(isVisualAttachment({ kind: 'FILE', mimeType: 'application/pdf', url: 'paper.pdf' })).toBe(false);
  });

  test('redacts existing visual media for teen viewers and teen senders without changing text or adult media', () => {
    const message = {
      rawContent: 'text stays', imageUrl: 'legacy.jpg',
      sender: { id: 1, ageBand: 'ADULT_18_24' },
      attachments: [
        { kind: 'IMAGE', url: 'private/photo.jpg', thumbUrl: 'private/thumb.jpg' },
        { kind: 'AUDIO', url: 'private/voice.m4a' },
      ],
    };
    const adult = redactVisualMediaForViewer(message, false);
    expect(adult.attachments).toHaveLength(2);
    expect(adult.mediaRestricted).toBe(false);
    expect(adult.sender.ageBand).toBeUndefined();
    const teen = redactVisualMediaForViewer(message, true);
    expect(teen).toMatchObject({ rawContent: 'text stays', imageUrl: null, mediaRestricted: true });
    expect(teen.attachments).toEqual([{ kind: 'AUDIO', url: 'private/voice.m4a' }]);
    expect(message.attachments).toHaveLength(2);
    expect(redactVisualMediaForViewer({ ...message, imageUrl: null,
      sender: { id: 1, ageBand: 'TEEN_13_17' } }, false).mediaRestricted).toBe(true);
    expect(redactVisualMediaForViewer(message, false, true).attachments)
      .toEqual([{ kind: 'AUDIO', url: 'private/voice.m4a' }]);
  });

  test('checks current room participants and returns an explicit 403 restriction', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 4 }).mockResolvedValueOnce(null);
    const db = { participant: { findFirst } };
    expect(await roomHasTeen(db, 8)).toBe(true);
    expect(await roomHasTeen(db, 8)).toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      where: { chatRoomId: 8, user: { ageBand: 'TEEN_13_17' } }, select: { id: true },
    });
    const error = visualMediaRestrictionError();
    expect(error.output.statusCode).toBe(403);
    expect(error.output.payload.code).toBe('TEEN_VISUAL_MEDIA_RESTRICTED');
  });

  test('withholds teen MMS images, video, and unknown legacy keys while preserving audio and text', () => {
    const original = { body: 'hello', mediaUrls: [
      { url: 'https://provider.invalid/one', contentType: 'image/jpeg' },
      { url: 'https://provider.invalid/two', contentType: 'audio/mpeg' },
      'uploads/u1/legacy',
    ] };
    expect(isTeenMmsRestricted({ url: 'x', contentType: 'video/mp4' })).toBe(true);
    expect(isTeenMmsRestricted({ url: 'x', contentType: 'audio/mpeg' })).toBe(false);
    expect(redactTeenSmsMedia(original, true)).toMatchObject({
      body: 'hello', mediaRestricted: true,
      mediaUrls: [{ url: 'https://provider.invalid/two', contentType: 'audio/mpeg' }],
    });
    expect(redactTeenSmsMedia(original, false)).toBe(original);
  });
});
