import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockCreate = jest.fn();
const mockSendMail = jest.fn();

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    adInquiry: {
      create: mockCreate,
    },
  },
}));

jest.unstable_mockModule('../utils/sendMail.js', () => ({
  __esModule: true,
  sendMail: mockSendMail,
}));

const { default: router } = await import('../routes/ads.js');

function createApp() {
  const app = express();

  app.use(express.json());

  app.use('/ads', router);

  // basic error handler
  app.use((err, _req, res, _next) => {
    // console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

describe('POST /ads/inquiries', () => {
  let app;
  let errorSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    app = createApp();

    errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/ads/inquiries')
      .send({});

    expect(res.status).toBe(400);

    expect(res.body).toEqual({
      error:
        'Missing required fields: name, email, and message are required.',
    });

    expect(mockCreate).not.toHaveBeenCalled();

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('returns 400 when email is invalid', async () => {
    const res = await request(app)
      .post('/ads/inquiries')
      .send({
        name: 'Julian',
        email: 'not-an-email',
        message: 'I want to advertise.',
      });

    expect(res.status).toBe(400);

    expect(res.body).toEqual({
      error: 'Invalid email address.',
    });

    expect(mockCreate).not.toHaveBeenCalled();

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('creates inquiry, sends email, and returns 201 when everything is valid', async () => {
    const mockInquiry = {
      id: 42,
      name: 'Julian',
      email: 'julian@example.com',
      company: 'Chatforia LLC',
      budget: '$5,000/mo',
      message: 'We want to run ads inside Chatforia.',
      status: 'new',
    };

    mockCreate.mockResolvedValueOnce(mockInquiry);

    mockSendMail.mockResolvedValueOnce({});

    const payload = {
      name: 'Julian',
      email: 'julian@example.com',
      company: 'Chatforia LLC',
      budget: '$5,000/mo',
      message: 'We want to run ads inside Chatforia.',
    };

    const res = await request(app)
      .post('/ads/inquiries')
      .send(payload);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: payload.name,
        email: payload.email,
        company: payload.company,
        budget: payload.budget,
        message: payload.message,
        status: 'new',
      },
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);

    expect(mockSendMail).toHaveBeenCalledWith({
      to: 'ads@chatforia.com',
      subject: 'New advertising inquiry from Julian',
      html: expect.stringContaining('Internal ID:</strong> 42'),
      replyTo: 'julian@example.com',
    });

    expect(res.status).toBe(201);

    expect(res.body).toEqual({
      ok: true,
      id: 42,
    });
  });

  it('creates inquiry and still returns 201 when sendMail fails', async () => {
    const mockInquiry = {
      id: 99,
      name: 'Julian',
      email: 'julian@example.com',
      company: null,
      budget: null,
      message: 'Simple inquiry',
      status: 'new',
    };

    mockCreate.mockResolvedValueOnce(mockInquiry);

    mockSendMail.mockRejectedValueOnce(
      new Error('SMTP connection failed')
    );

    const res = await request(app)
      .post('/ads/inquiries')
      .send({
        name: 'Julian',
        email: 'julian@example.com',
        message: 'Simple inquiry',
      });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: 'Julian',
        email: 'julian@example.com',
        company: null,
        budget: null,
        message: 'Simple inquiry',
        status: 'new',
      },
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);

    expect(errorSpy).toHaveBeenCalled();

    expect(errorSpy.mock.calls[0][0]).toContain(
      'Failed to send ad inquiry email:'
    );

    expect(res.status).toBe(201);

    expect(res.body).toEqual({
      ok: true,
      id: 99,
    });
  });

  it('returns 500 when prisma create throws', async () => {
    mockCreate.mockRejectedValueOnce(
      new Error('Database unavailable')
    );

    const res = await request(app)
      .post('/ads/inquiries')
      .send({
        name: 'Julian',
        email: 'julian@example.com',
        message: 'Database failure test',
      });

    expect(mockCreate).toHaveBeenCalledTimes(1);

    expect(mockSendMail).not.toHaveBeenCalled();

    expect(res.status).toBe(500);

    expect(res.body).toEqual({
      error: 'Internal server error',
    });
  });
});