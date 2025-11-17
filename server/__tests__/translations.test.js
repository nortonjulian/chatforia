import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Shared mocks ---
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  translation: {
    findMany: jest.fn(),
  },
};

const mockTranslateBatch = jest.fn();
const mockRequireAuth = jest.fn((req, _res, next) => {
  // Simulate an authenticated user
  req.user = { id: 123 };
  next();
});

const mockReadFile = jest.fn();

// Mock express-rate-limit so it just passes through
const mockRateLimit = jest.fn(() => (req, res, next) => next());
const mockIpKeyGenerator = jest.fn(() => 'ip-key');

// ----- Set up module mocks BEFORE importing router -----
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: mockRequireAuth,
}));

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

await jest.unstable_mockModule('../services/translation/index.js', () => ({
  __esModule: true,
  translateBatch: mockTranslateBatch,
}));

await jest.unstable_mockModule('express-rate-limit', () => ({
  __esModule: true,
  default: mockRateLimit,
  ipKeyGenerator: mockIpKeyGenerator,
}));

await jest.unstable_mockModule('fs/promises', () => ({
  __esModule: true,
  default: { readFile: mockReadFile },
  readFile: mockReadFile,
}));

// Now import the router under test
const translationsRouter =
  (await import('../routes/translations.js')).default;

// Build an Express app using the router
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/translations', translationsRouter);

  // Simple error handler to surface Boom errors as JSON
  app.use((err, _req, res, _next) => {
    if (err?.isBoom && err.output) {
      return res
        .status(err.output.statusCode)
        .json({ message: err.message });
    }
    return res.status(500).json({ message: err.message });
  });

  return app;
}

describe('translations routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  describe('POST /translations/batch', () => {
    it('translates a batch, using user preferredLanguage when target is missing', async () => {
      // user preferred language from DB
      mockPrisma.user.findUnique.mockResolvedValue({
        preferredLanguage: 'es',
      });

      // translation service returns results for each item
      mockTranslateBatch.mockResolvedValue([
        { text: 'hola', detectedSourceLanguage: 'en' },
        { text: 'adiós', detectedSourceLanguage: 'en' },
      ]);

      const res = await request(app)
        .post('/translations/batch')
        .send({
          items: [
            { id: 'a', text: 'Hello' },
            { id: 'b', text: 'Goodbye' },
          ],
          // no target -> should use preferredLanguage 'es'
        })
        .expect(200);

      // User preferredLanguage lookup
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 123 },
        select: { preferredLanguage: true },
      });

      // translateBatch called with the texts + targetLanguage 'es'
      expect(mockTranslateBatch).toHaveBeenCalledWith(
        ['Hello', 'Goodbye'],
        'es'
      );

      expect(res.body).toEqual({
        translations: [
          {
            id: 'a',
            translatedText: 'hola',
            detectedSourceLanguage: 'en',
            targetLanguage: 'es',
          },
          {
            id: 'b',
            translatedText: 'adiós',
            detectedSourceLanguage: 'en',
            targetLanguage: 'es',
          },
        ],
      });
    });

    it('uses explicit target language from body without hitting DB', async () => {
      mockTranslateBatch.mockResolvedValue([
        { text: 'bonjour', detectedSourceLanguage: 'en' },
      ]);

      const res = await request(app)
        .post('/translations/batch')
        .send({
          items: [{ id: 'x', text: 'Hi' }],
          target: 'fr',
        })
        .expect(200);

      // Should NOT consult user preferredLanguage when target is provided
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();

      expect(mockTranslateBatch).toHaveBeenCalledWith(
        ['Hi'],
        'fr'
      );

      expect(res.body).toEqual({
        translations: [
          {
            id: 'x',
            translatedText: 'bonjour',
            detectedSourceLanguage: 'en',
            targetLanguage: 'fr',
          },
        ],
      });
    });

    it('returns 400 when items array is missing or empty', async () => {
      const res = await request(app)
        .post('/translations/batch')
        .send({}) // no items
        .expect(400);

      expect(res.body).toEqual({
        message: 'items required',
      });

      expect(mockTranslateBatch).not.toHaveBeenCalled();
    });
  });

  describe('GET /translations', () => {
    it('serves merged translation JSON (file + DB overrides) and sets no-store cache header', async () => {
      // lng=es -> "es"
      const fileJson = {
        profile: {
          title: 'User Profile',
          nested: {
            original: 'keep-me',
          },
        },
      };

      mockReadFile.mockResolvedValueOnce(JSON.stringify(fileJson));

      mockPrisma.translation.findMany.mockResolvedValue([
        { key: 'profile.title', value: 'Perfil de usuario' },
        { key: 'profile.newKey', value: 'Nuevo valor' },
      ]);

      const res = await request(app)
        .get('/translations')
        .query({ lng: 'es-ES', ns: 'translation' })
        .expect(200);

      // fs.readFile called with path containing our expected segments
      expect(mockReadFile).toHaveBeenCalledTimes(1);
      const readPath = mockReadFile.mock.calls[0][0];
      expect(readPath).toContain('client/public/locales');
      expect(readPath).toContain('es');
      expect(readPath).toContain('translation.json');

      // Prisma translation rows fetched for language 'es'
      expect(mockPrisma.translation.findMany).toHaveBeenCalledWith({
        where: { language: 'es' },
        select: { key: true, value: true },
      });

      // Cache-Control header
      expect(res.headers['cache-control']).toBe('no-store');

      // DB overrides file JSON + adds new nested key
      expect(res.body).toEqual({
        profile: {
          title: 'Perfil de usuario', // overridden
          nested: {
            original: 'keep-me',
          },
          newKey: 'Nuevo valor',
        },
      });
    });

    it('handles missing file gracefully and still returns DB-based JSON', async () => {
      // Simulate file missing => readFile throws
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      mockPrisma.translation.findMany.mockResolvedValue([
        { key: 'common.save', value: 'Guardar' },
      ]);

      const res = await request(app)
        .get('/translations')
        .query({ lng: 'es', ns: 'common' })
        .expect(200);

      // File error should not crash; fileJson becomes {}
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      // Response payload built from DB rows only
      expect(res.body).toEqual({
        common: {
          save: 'Guardar',
        },
      });
    });
  });
});
