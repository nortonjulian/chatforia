import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Mocks ---
const fetchMock = jest.fn();

const mockRequireAuth = jest.fn((req, _res, next) => {
  // simulate authenticated user
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

  // basic error handler (route already catches most errors)
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
    delete process.env.TENOR_API_KEY;
  });

  describe('GET /stickers/search', () => {
    it('returns empty results when q is missing/blank', async () => {
      const res = await request(app)
        .get('/stickers/search')
        .expect(200);

      expect(res.body).toEqual({ results: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 501 when TENOR_API_KEY is not configured', async () => {
      process.env.TENOR_API_KEY = ''; // or leave undefined

      const res = await request(app)
        .get('/stickers/search')
        .query({ q: 'cat' })
        .expect(501);

      expect(res.body).toEqual({
        error: 'No sticker search key configured',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('hits Tenor and maps results on success', async () => {
      process.env.TENOR_API_KEY = 'test-tenor-key';

      // Mock Tenor response
      fetchMock.mockResolvedValueOnce({
        json: async () => ({
          results: [
            {
              id: 'gif1',
              media_formats: {
                tinygif: { url: 'https://tiny.gif/1' },
                mediumgif: {
                  url: 'https://med.gif/1',
                  dims: [200, 100],
                },
                gif: { url: 'https://fallback.gif/1' },
              },
            },
            {
              id: 'gif2',
              media_formats: {
                // missing tinygif/mediumgif -> fallback to gif
                gif: { url: 'https://fallback.gif/2' },
              },
            },
          ],
        }),
      });

      const res = await request(app)
        .get('/stickers/search')
        .query({ q: 'cats' })
        .expect(200);

      // Verify fetch was called with correct URL + params
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [urlArg] = fetchMock.mock.calls[0];
      expect(urlArg).toBeInstanceOf(URL);
      expect(urlArg.origin).toBe('https://tenor.googleapis.com');
      expect(urlArg.pathname).toBe('/v2/search');
      expect(urlArg.searchParams.get('q')).toBe('cats');
      expect(urlArg.searchParams.get('key')).toBe('test-tenor-key');
      expect(urlArg.searchParams.get('limit')).toBe('24');
      expect(urlArg.searchParams.get('media_filter')).toBe(
        'tinygif,mediumgif'
      );

      // Mapped response
      expect(res.body).toEqual({
        results: [
          {
            id: 'gif1',
            kind: 'GIF',
            url: 'https://med.gif/1',
            thumb: 'https://tiny.gif/1',
            mimeType: 'image/gif',
            width: 200,
            height: 100,
          },
          {
            id: 'gif2',
            kind: 'GIF',
            url: 'https://fallback.gif/2',
            thumb: 'https://fallback.gif/2',
            mimeType: 'image/gif',
            width: null,
            height: null,
          },
        ],
      });
    });

    it('returns 500 when Tenor request throws', async () => {
      process.env.TENOR_API_KEY = 'test-tenor-key';

      fetchMock.mockRejectedValueOnce(new Error('network down'));

      const res = await request(app)
        .get('/stickers/search')
        .query({ q: 'dogs' })
        .expect(500);

      expect(res.body).toEqual({ error: 'search failed' });
    });
  });
});
