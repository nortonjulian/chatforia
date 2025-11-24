import express from 'express';
import request from 'supertest';
import router from './porting.js';
import {
  createPortRequestForUser,
  getUserPortRequests,
  getUserPortRequestById,
} from '../services/portingService.js';

jest.mock('../services/portingService.js', () => ({
  createPortRequestForUser: jest.fn(),
  getUserPortRequests: jest.fn(),
  getUserPortRequestById: jest.fn(),
}));

const mockUser = { id: 'user_123', email: 'test@example.com' };

function createApp(user) {
  const app = express();
  app.use(express.json());

  // Fake auth middleware to populate req.user (or leave undefined)
  if (user !== undefined) {
    app.use((req, _res, next) => {
      req.user = user;
      next();
    });
  }

  app.use('/api/porting', router);

  // Basic error handler so thrown errors don't crash tests
  app.use((err, _req, res, _next) => {
    // eslint-disable-next-line no-console
    console.error('Error handler caught:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

describe('porting routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/porting', () => {
    it('returns 401 when user is not authenticated', async () => {
      const app = createApp(undefined);

      const res = await request(app)
        .post('/api/porting')
        .send({ phoneNumber: '+1 555 123 4567' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
      expect(createPortRequestForUser).not.toHaveBeenCalled();
    });

    it('creates a port request for authenticated user', async () => {
      const app = createApp(mockUser);

      const body = {
        phoneNumber: '+1 555 123 4567',
        carrier: 'Verizon',
        accountNumber: 'ACC-123',
      };

      const mockPortRequest = {
        id: 'port_1',
        userId: mockUser.id,
        phoneNumber: body.phoneNumber,
        status: 'PENDING',
      };

      createPortRequestForUser.mockResolvedValueOnce(mockPortRequest);

      const res = await request(app).post('/api/porting').send(body);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockPortRequest);
      expect(createPortRequestForUser).toHaveBeenCalledWith(mockUser, body);
    });
  });

  describe('GET /api/porting', () => {
    it('returns 401 when user is not authenticated', async () => {
      const app = createApp(undefined);

      const res = await request(app).get('/api/porting');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
      expect(getUserPortRequests).not.toHaveBeenCalled();
    });

    it('returns list of port requests for authenticated user', async () => {
      const app = createApp(mockUser);

      const mockRequests = [
        { id: 'port_1', userId: mockUser.id, phoneNumber: '+1 555 111 1111' },
        { id: 'port_2', userId: mockUser.id, phoneNumber: '+1 555 222 2222' },
      ];

      getUserPortRequests.mockResolvedValueOnce(mockRequests);

      const res = await request(app).get('/api/porting');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockRequests);
      expect(getUserPortRequests).toHaveBeenCalledWith(mockUser.id);
    });
  });

  describe('GET /api/porting/:id', () => {
    it('returns 401 when user is not authenticated', async () => {
      const app = createApp(undefined);

      const res = await request(app).get('/api/porting/port_1');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
      expect(getUserPortRequestById).not.toHaveBeenCalled();
    });

    it('returns 404 when port request is not found', async () => {
      const app = createApp(mockUser);

      getUserPortRequestById.mockResolvedValueOnce(null);

      const res = await request(app).get('/api/porting/port_missing');

      expect(getUserPortRequestById).toHaveBeenCalledWith(
        mockUser.id,
        'port_missing'
      );
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    it('returns port request when found', async () => {
      const app = createApp(mockUser);

      const mockRequest = {
        id: 'port_1',
        userId: mockUser.id,
        phoneNumber: '+1 555 123 4567',
        status: 'PENDING',
      };

      getUserPortRequestById.mockResolvedValueOnce(mockRequest);

      const res = await request(app).get('/api/porting/port_1');

      expect(getUserPortRequestById).toHaveBeenCalledWith(
        mockUser.id,
        'port_1'
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockRequest);
    });
  });
});
