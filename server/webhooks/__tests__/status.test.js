import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

// Mock handleStatusUpdate BEFORE importing the router
const handleStatusUpdateMock = jest.fn();

jest.unstable_mockModule('../../lib/telco/messageMonitor.js', () => ({
  __esModule: true,
  handleStatusUpdate: handleStatusUpdateMock,
}));

// Import the router AFTER mocks are set up
const { default: statusRouter } = await import('./status.js');

describe('Twilio /webhooks/status router', () => {
  let app;

  beforeAll(() => {
    app = express();
    // The router already has urlencoded middleware, but this is harmless
    app.use('/webhooks', statusRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls handleStatusUpdate with the request body and responds 200 "ok"', async () => {
    handleStatusUpdateMock.mockResolvedValueOnce();

    const body = {
      MessageSid: 'SM123',
      MessageStatus: 'delivered',
      To: '+15551234567',
      From: '+15557654321',
      ErrorCode: '30005',
      ErrorMessage: 'Unknown destination handset',
    };

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const res = await request(app)
      .post('/webhooks/status')
      .type('form') // important: router uses express.urlencoded
      .send(body);

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');

    // handleStatusUpdate gets the full body spread
    expect(handleStatusUpdateMock).toHaveBeenCalledTimes(1);
    expect(handleStatusUpdateMock).toHaveBeenCalledWith(expect.objectContaining(body));

    // console.log called with the formatted status line + details object
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [msg, meta] = logSpy.mock.calls[0];

    expect(msg).toBe('[Twilio Status] SM123: delivered');
    expect(meta).toEqual({
      To: body.To,
      From: body.From,
      ErrorCode: body.ErrorCode,
      ErrorMessage: body.ErrorMessage,
    });

    logSpy.mockRestore();
  });

  it('handles missing optional fields gracefully', async () => {
    handleStatusUpdateMock.mockResolvedValueOnce();

    const body = {
      MessageSid: 'SM999',
      MessageStatus: 'failed',
      // To / From / ErrorCode / ErrorMessage omitted
    };

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const res = await request(app)
      .post('/webhooks/status')
      .type('form')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');

    expect(handleStatusUpdateMock).toHaveBeenCalledTimes(1);
    expect(handleStatusUpdateMock).toHaveBeenCalledWith(expect.objectContaining(body));

    // It should still log without blowing up
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [msg, meta] = logSpy.mock.calls[0];

    expect(msg).toBe('[Twilio Status] SM999: failed');
    expect(meta).toEqual({
      To: undefined,
      From: undefined,
      ErrorCode: undefined,
      ErrorMessage: undefined,
    });

    logSpy.mockRestore();
  });

  it('returns 500 if handleStatusUpdate throws (via asyncHandler)', async () => {
    handleStatusUpdateMock.mockRejectedValueOnce(new Error('boom'));

    const res = await request(app)
      .post('/webhooks/status')
      .type('form')
      .send({
        MessageSid: 'SMERR',
        MessageStatus: 'failed',
      });

    // Express default error handler -> 500
    expect(res.status).toBe(500);
  });
});
