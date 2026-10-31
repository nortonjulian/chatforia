import { assertCarrierMmsFile, prepareCarrierMmsFile } from '../prepareCarrierMmsFile';

describe('carrier MMS file preparation', () => {
  test('rejects MP4 over 500 KB before uploading', async () => {
    const video = new File([new Uint8Array(500_001)], 'clip.mp4', { type: 'video/mp4' });
    await expect(prepareCarrierMmsFile(video)).rejects.toThrow('500 KB');
  });

  test('preserves GIF animation without JPEG conversion', async () => {
    const gif = new File(['GIF89a'], 'animated.gif', { type: 'image/gif' });
    await expect(prepareCarrierMmsFile(gif)).resolves.toBe(gif);
  });

  test('rejects unsupported files', async () => {
    const pdf = new File(['pdf'], 'file.pdf', { type: 'application/pdf' });
    expect(() => assertCarrierMmsFile(pdf)).toThrow('Carrier MMS accepts');
  });

  test('checks UTF-8 caption bytes as part of the 5 MB aggregate', () => {
    const img = { type: 'image/jpeg', size: 4_999_998 };
    expect(() => assertCarrierMmsFile(img, '😄')).toThrow('Media and message text together');
  });

  test('converts a still image into a carrier JPEG around 1 MB', async () => {
    const file = new File(['fake-png'], 'image.png', { type: 'image/png' });
    const bitmap = { width: 1200, height: 800, close: jest.fn() };
    const old = global.createImageBitmap;
    global.createImageBitmap = jest.fn().mockResolvedValue(bitmap);
    const originalCreate = document.createElement.bind(document);
    const createElement = jest.spyOn(document, 'createElement').mockImplementation(tag => {
      if (tag !== 'canvas') return originalCreate(tag);
      return {
        width: 0, height: 0,
        getContext: () => ({ fillRect: jest.fn(), drawImage: jest.fn(), set fillStyle(_) {} }),
        toBlob: (cb, type) => cb(new Blob(['jpeg'], { type })),
      };
    });
    try {
      const converted = await prepareCarrierMmsFile(file);
      expect(converted.type).toBe('image/jpeg');
      expect(converted.name).toBe('mms-photo.jpg');
      expect(converted.size).toBeLessThan(1_000_000);
      expect(bitmap.close).toHaveBeenCalled();
    } finally {
      createElement.mockRestore();
      global.createImageBitmap = old;
    }
  });
});
