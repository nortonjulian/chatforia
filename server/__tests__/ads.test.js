import express from 'express';
import request from 'supertest';
import prisma from '../utils/prismaClient.js';
import nodemailer from 'nodemailer';
import router from './ads.js';

jest.mock('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    adInquiry: {
      create: jest.fn(),
    },
  },
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const ORIGINAL_ENV = process.env;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/ads', router);

  // basic error handler
  app.use((err, _req, res, _next) => {
    // console.error(err); // optional
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

describe('POST /ads/inquiries', () => {
  let app;
  let errorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules(); // for safety with env
    process.env = { ...ORIGINAL_ENV };
    app = createApp();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    errorSpy.mockRestore();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/ads/inquiries').send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Missing required fields: name, email, and message are required.',
    });

    expect(prisma.adInquiry.create).not.toHaveBeenCalled();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
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

    expect(prisma.adInquiry.create).not.toHaveBeenCalled();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('creates inquiry, sends email, and returns 201 when everything is valid', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';
    // no SMTP_FROM -> should default to ads@chatforia.com

    const mockInquiry = {
      id: 42,
      name: 'Julian',
      email: 'julian@example.com',
      company: 'Chatforia LLC',
      budget: '$5,000/mo',
      message: 'We want to run ads inside Chatforia.',
      status: 'new',
    };

    prisma.adInquiry.create.mockResolvedValueOnce(mockInquiry);

    const sendMail = jest.fn().mockResolvedValue({});
    nodemailer.createTransport.mockReturnValueOnce({ sendMail });

    const payload = {
      name: 'Julian',
      email: 'julian@example.com',
      company: 'Chatforia LLC',
      budget: '$5,000/mo',
      message: 'We want to run ads inside Chatforia.',
    };

    const res = await request(app).post('/ads/inquiries').send(payload);

    // DB write
    expect(prisma.adInquiry.create).toHaveBeenCalledWith({
      data: {
        name: payload.name,
        email: payload.email,
        company: payload.company,
        budget: payload.budget,
        message: payload.message,
        status: 'new',
      },
    });

    // Nodemailer transport created correctly
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'smtp-user',
        pass: 'smtp-pass',
      },
    });

    // Email sent with expected fields
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = sendMail.mock.calls[0][0];
    expect(mailArgs.from).toBe('ads@chatforia.com'); // default
    expect(mailArgs.to).toBe('ads@chatforia.com');
    expect(mailArgs.replyTo).toBe('julian@example.com');
    expect(mailArgs.subject).toBe('New advertising inquiry from Julian');
    expect(mailArgs.text).toContain('New advertising inquiry:');
    expect(mailArgs.text).toContain('Name: Julian');
    expect(mailArgs.text).toContain('Email: julian@example.com');
    expect(mailArgs.text).toContain('Company: Chatforia LLC');
    expect(mailArgs.text).toContain('Budget: $5,000/mo');
    expect(mailArgs.text).toContain('We want to run ads inside Chatforia.');
    expect(mailArgs.text).toContain('Internal ID: 42');

    // Response
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, id: 42 });
  });

  it('creates inquiry and still returns 201 when SMTP config is missing (email send fails)', async () => {
    // ensure SMTP env is missing so createTransporter throws
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const mockInquiry = {
      id: 99,
      name: 'Julian',
      email: 'julian@example.com',
      company: null,
      budget: null,
      message: 'Simple inquiry',
      status: 'new',
    };

    prisma.adInquiry.create.mockResolvedValueOnce(mockInquiry);

    const res = await request(app).post('/ads/inquiries').send({
      name: 'Julian',
      email: 'julian@example.com',
      message: 'Simple inquiry',
    });

    // DB write still happens
    expect(prisma.adInquiry.create).toHaveBeenCalledWith({
      data: {
        name: 'Julian',
        email: 'julian@example.com',
        company: null,
        budget: null,
        message: 'Simple inquiry',
        status: 'new',
      },
    });

    // No transporter created because createTransporter throws
    expect(nodemailer.createTransport).not.toHaveBeenCalled();

    // Error during email sending is logged but does not fail request
    expect(errorSpy).toHaveBeenCalled();
    const errorMsg = errorSpy.mock.calls[0][0];
    expect(errorMsg).toContain('Failed to send ad inquiry email:');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, id: 99 });
  });

  it('creates inquiry and returns 201 when transporter.sendMail rejects', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';

    const mockInquiry = {
      id: 7,
      name: 'Julian',
      email: 'julian@example.com',
      company: null,
      budget: null,
      message: 'Another inquiry',
      status: 'new',
    };

    prisma.adInquiry.create.mockResolvedValueOnce(mockInquiry);

    const sendMail = jest
      .fn()
      .mockRejectedValue(new Error('SMTP connection failed'));
    nodemailer.createTransport.mockReturnValueOnce({ sendMail });

    const res = await request(app).post('/ads/inquiries').send({
      name: 'Julian',
      email: 'julian@example.com',
      message: 'Another inquiry',
    });

    // We attempted to send email
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);

    // Logged but did not break response
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0]).toContain(
      'Failed to send ad inquiry email:'
    );

    // Response still successful
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, id: 7 });
  });
});
