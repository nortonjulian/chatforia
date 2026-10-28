import { privateAttachmentReference } from '../privateAttachmentReference';

describe('private attachment reference', () => {
  test('prefers the R2 object key over a public URL', () => {
    expect(privateAttachmentReference({
      key: 'uploads/u7/2026/10/28/voice.webm',
      url: 'https://cdn.chatforia.com/uploads/u7/2026/10/28/voice.webm',
    })).toBe('uploads/u7/2026/10/28/voice.webm');
  });

  test('supports private uploads with no public URL', () => {
    expect(privateAttachmentReference({
      key: 'uploads/u7/2026/10/28/photo.jpg',
      url: null,
    })).toBe('uploads/u7/2026/10/28/photo.jpg');
  });

  test('preserves legacy and external media references', () => {
    expect(privateAttachmentReference({
      url: 'https://example.com/attachment.jpg',
    })).toBe('https://example.com/attachment.jpg');
  });

  test('returns null if no usable reference exists', () => {
    expect(privateAttachmentReference({})).toBeNull();
  });
});
