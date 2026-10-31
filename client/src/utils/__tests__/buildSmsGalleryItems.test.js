import { buildSmsGalleryItems } from '../buildSmsGalleryItems.js';

describe('SMS media gallery source', () => {
  test('includes inbound and outbound media from the current thread', () => {
    const items = buildSmsGalleryItems([
      {
        id: 42, createdAt: '2026-10-30T20:00:00Z', direction: 'in',
        mediaUrls: ['https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages/MMxxx/Media/MExxx'],
      },
      {
        id: 43, createdAt: '2026-10-30T21:00:00Z', direction: 'out',
        mediaUrls: ['uploads/u65/2026/10/30/photo.jpg'],
      },
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        id: '43:0', messageId: 43, mediaIndex: 0,
        item: 'uploads/u65/2026/10/30/photo.jpg',
      }),
      expect.objectContaining({
        id: '42:0', messageId: 42, mediaIndex: 0,
      }),
    ]);
  });

  test('preserves provider media indexes when empty entries are present', () => {
    const items = buildSmsGalleryItems([
      { id: 7, mediaUrls: [null, 'uploads/u1/picture.jpg'] },
    ]);
    expect(items).toEqual([
      expect.objectContaining({ id: '7:1', mediaIndex: 1 }),
    ]);
  });

  test('handles JSON-object media and multiple attachments', () => {
    const items = buildSmsGalleryItems([
      { id: 9, mediaUrls: { 0: { url: 'uploads/u1/first.png', mimeType: 'image/png' }, 1: 'uploads/u1/second.jpg' } },
    ]);
    expect(items.map(it => it.id)).toEqual(['9:0', '9:1']);
    expect(items[0].item).toMatchObject({ mimeType: 'image/png' });
  });

  test('has no media only when the thread has no usable references', () => {
    expect(buildSmsGalleryItems(null)).toEqual([]);
    expect(buildSmsGalleryItems([{ id: 1, mediaUrls: [] }, { id: 2, mediaUrls: [null, ''] }])).toEqual([]);
  });

  test('uses the authenticated proxy tuple, never a direct download URL', () => {
    const items = buildSmsGalleryItems([
      { id: 17, mediaUrls: ['uploads/u1/image.jpg'] },
    ]);
    expect(items[0]).toMatchObject({ messageId: 17, mediaIndex: 0 });
    expect(items[0]).not.toHaveProperty('url');
  });
});
