import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
} from '@jest/globals';

const { validate } = await import('../validate.js');

function makeRes() {
  return {
    status: jest.fn(function (code) {
      this._status = code;
      return this;
    }),
    json: jest.fn(function (body) {
      this._body = body;
      return this;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('validate middleware factory', () => {
  test('on success: overwrites req.body with parsed data and calls next()', () => {
    const schema = {
      safeParse: jest.fn().mockReturnValue({
        success: true,
        data: { name: 'Julian', age: 30 },
      }),
    };

    const originalBody = { name: 'julian ', age: '30' };
    const req = { body: { ...originalBody } };
    const res = makeRes();
    const next = jest.fn();

    const mw = validate(schema); // default where = 'body'
    mw(req, res, next);

    expect(schema.safeParse).toHaveBeenCalledTimes(1);
    // safeParse should have received the original body, before mutation
    expect(schema.safeParse).toHaveBeenCalledWith(originalBody);

    // req.body should now be the parsed data
    expect(req.body).toEqual({ name: 'Julian', age: 30 });

    // should move on
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('on failure: responds with 422 and error payload, does not call next()', () => {
    const flattenedError = { fieldErrors: { name: ['Required'] } };
    const schema = {
      safeParse: jest.fn().mockReturnValue({
        success: false,
        error: { flatten: () => flattenedError },
      }),
    };

    const req = { body: { name: '' } };
    const res = makeRes();
    const next = jest.fn();

    const mw = validate(schema); // body
    mw(req, res, next);

    expect(schema.safeParse).toHaveBeenCalledTimes(1);
    expect(schema.safeParse).toHaveBeenCalledWith({ name: '' });

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: 'ValidationError',
      details: flattenedError,
    });

    expect(next).not.toHaveBeenCalled();
  });

  test('supports custom where (e.g., query)', () => {
    const schema = {
      safeParse: jest.fn().mockReturnValue({
        success: true,
        data: { page: 2 },
      }),
    };

    const originalQuery = { page: '2' };
    const req = {
      query: { ...originalQuery },
      body: { untouched: true },
    };
    const res = makeRes();
    const next = jest.fn();

    const mw = validate(schema, 'query');
    mw(req, res, next);

    expect(schema.safeParse).toHaveBeenCalledWith(originalQuery);

    // Only query is replaced
    expect(req.query).toEqual({ page: 2 });
    expect(req.body).toEqual({ untouched: true });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
