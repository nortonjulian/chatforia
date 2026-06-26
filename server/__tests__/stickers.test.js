import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Mocks ---
const fetchMock = jest.fn();

const mockRequireAuth = jest.fn((req, _res, next) => {
  req.user = { id: 1 };
  next();
});

// Mock node-fetch and requireAuth BEFORE importing router
await jest.unstable_mockModule('node-fetch', () => ({
  __esModule: true,
  default: fetchMock,
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: mockRequireAuth,
}));

// Import router under test
const stickersRouter = (await import('../routes/stickers.js')).default;

// Build Express app
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/stickers', stickersRouter);

  app.use((err, _req, res, _next) => {
    return res.status(500).json({ error: err.message });
  });

  return app;
}

describe('stickers routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();

    delete process.env.GIPHY_API_KEY;
  });

  describe('GET /stickers/search', () => {
    it('returns 501 when GIPHY_API_KEY is not configured', async () => {
      process.env.GIPHY_API_KEY = '';

      const res = await request(app)
        .get('/stickers/search')
        .query({ q: 'cat' })
        .expect(501);

      expect(res.body).toEqual({
        error: 'No sticker search key configured',
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('hits GIPHY trending when q is missing/blank', async () => {
      process.env.GIPHY_API_KEY = 'test-giphy-key';

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'trending1',
              title: 'Trending GIF',
              images: {
                fixed_width_small: {
                  url: 'https://giphy.test/trending-small.gif',
                  width: '100',
                  height: '80',
                },
                fixed_width: {
                  url: 'https://giphy.test/trending-med.gif',
                  width: '200',
                  height: '160',
                },
                original: {
                  url: 'https://giphy.test/trending-original.gif',
                  width: '400',
                  height: '320',
                },
              },
            },
          ],
        }),
      });

      const res = await request(app)
        .get('/stickers/search')
        .expect(200);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [urlArg] = fetchMock.mock.calls[0];
      expect(urlArg).toBeInstanceOf(URL);
      expect(urlArg.origin).toBe('https://api.giphy.com');
      expect(urlArg.pathname).toBe('/v1/gifs/trending');
      expect(urlArg.searchParams.get('api_key')).toBe('test-giphy-key');
      expect(urlArg.searchParams.get('limit')).toBe('36');
      expect(urlArg.searchParams.get('rating')).toBe('pg');
      expect(urlArg.searchParams.get('q')).toBe(null);

      expect(res.body).toEqual({
        results: [
          {
            id: 'trending1',
            title: 'Trending GIF',
            kind: 'GIF',
            url: 'https://giphy.test/trending-med.gif',
            thumb: 'https://giphy.test/trending-small.gif',
            previewUrl: 'https://giphy.test/trending-small.gif',
            previewURL: 'https://giphy.test/trending-small.gif',
            mimeType: 'image/gif',
            width: 200,
            height: 160,
            provider: 'giphy',
            providerId: 'trending1',
            tenorID: 'trending1',
            tenorId: 'trending1',
          },
        ],
      });
    });

    it('hits GIPHY search and maps results on success', async () => {
      process.env.GIPHY_API_KEY = 'test-giphy-key';

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'gif1',
              title: 'Cat GIF',
              images: {
                fixed_width_small: {
                  url: 'https://giphy.test/small-1.gif',
                  width: '100',
                  height: '50',
                },
                downsized_medium: {
                  url: 'https://giphy.test/medium-1.gif',
                  width: '200',
                  height: '100',
                },
                original: {
                  url: 'https://giphy.test/original-1.gif',
                  width: '400',
                  height: '200',
                },
              },
            },
            {
              id: 'gif2',
              title: 'Fallback GIF',
              images: {
                original: {
                  url: 'https://giphy.test/original-2.gif',
                  width: '300',
                  height: '150',
                },
              },
            },
          ],
        }),
      });

      const res = await request(app)
        .get('/stickers/search')
        .query({ q: 'cats' })
        .expect(200);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [urlArg] = fetchMock.mock.calls[0];
      expect(urlArg).toBeInstanceOf(URL);
      expect(urlArg.origin).toBe('https://api.giphy.com');
      expect(urlArg.pathname).toBe('/v1/gifs/search');
      expect(urlArg.searchParams.get('q')).toBe('cats');
      expect(urlArg.searchParams.get('api_key')).toBe('test-giphy-key');
      expect(urlArg.searchParams.get('limit')).toBe('36');
      expect(urlArg.searchParams.get('rating')).toBe('pg');

      expect(res.body).toEqual({
        results: [
          {
            id: 'gif1',
            title: 'Cat GIF',
            kind: 'GIF',
            url: 'https://giphy.test/medium-1.gif',
            thumb: 'https://giphy.test/small-1.gif',
            previewUrl: 'https://giphy.test/small-1.gif',
            previewURL: 'https://giphy.test/small-1.gif',
            mimeType: 'image/gif',
            width: 200,
            height: 100,
            provider: 'giphy',
            providerId: 'gif1',
            tenorID: 'gif1',
            tenorId: 'gif1',
          },
          {
            id: 'gif2',
            title: 'Fallback GIF',
            kind: 'GIF',
            url: 'https://giphy.test/original-2.gif',
            thumb: 'https://giphy.test/original-2.gif',
            previewUrl: 'https://giphy.test/original-2.gif',
            previewURL: 'https://giphy.test/original-2.gif',
            mimeType: 'image/gif',
            width: 300,
            height: 150,
            provider: 'giphy',
            providerId: 'gif2',
            tenorID: 'gif2',
            tenorId: 'gif2',
          },
        ],
      });
    });

    it('returns 502 when GIPHY returns a bad response', async () => {
      process.env.GIPHY_API_KEY = 'test-giphy-key';

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const res = await request(app)
        .get('/stickers/search')
        .query({ q: 'dogs' })
        .expect(502);

      expect(res.body).toEqual({ error: 'GIF provider failed' });
    });

    it('returns 500 when GIPHY request throws', async () => {
      process.env.GIPHY_API_KEY = 'test-giphy-key';

      fetchMock.mockRejectedValueOnce(new Error('network down'));

      const res = await request(app)
        .get('/stickers/search')
        .query({ q: 'dogs' })
        .expect(500);

      expect(res.body).toEqual({ error: 'search failed' });
    });
  });
});