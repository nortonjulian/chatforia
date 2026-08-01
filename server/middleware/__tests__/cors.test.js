import {
  createCorsForbiddenError,
} from '../cors.js';

describe('CORS errors', () => {
  test('classifies a rejected origin as an expected 403', () => {
    const error =
      createCorsForbiddenError();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      'Not allowed by CORS'
    );
    expect(error.status).toBe(403);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe(
      'CORS_ORIGIN_FORBIDDEN'
    );
  });
});
