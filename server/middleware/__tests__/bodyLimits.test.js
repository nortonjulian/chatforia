import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from '@jest/globals';

const ORIGINAL_ENV = process.env;

let expressJsonMock;
let expressUrlencodedMock;
let jsonMw;
let urlMw;

// Mock express BEFORE importing bodyLimits.js
await jest.unstable_mockModule('express', () => {
  jsonMw = jest.fn((req, res, next) => next && next());
  urlMw = jest.fn((req, res, next) => next && next());

  expressJsonMock = jest.fn(() => jsonMw);
  expressUrlencodedMock = jest.fn(() => urlMw);

  return {
    __esModule: true,
    default: {
      json: expressJsonMock,
      urlencoded: expressUrlencodedMock,
    },
  };
});

// Import middleware AFTER mocks are registered
const { bodyLimits } = await import('../bodyLimits.js');

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...ORIGINAL_ENV,
  };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('bodyLimits middleware factory', () => {
  test('uses default limits when env vars are not set', () => {
    delete process.env.JSON_BODY_LIMIT;
    delete process.env.URLENCODED_BODY_LIMIT;

    const middlewares = bodyLimits();

    // Should return the two middlewares created by express.json/urlencoded
    expect(middlewares).toHaveLength(2);
    expect(middlewares[0]).toBe(jsonMw);
    expect(middlewares[1]).toBe(urlMw);

    expect(expressJsonMock).toHaveBeenCalledTimes(1);
    expect(expressJsonMock).toHaveBeenCalledWith({ limit: '200kb' });

    expect(expressUrlencodedMock).toHaveBeenCalledTimes(1);
    expect(expressUrlencodedMock).toHaveBeenCalledWith({
      limit: '100kb',
      extended: true,
    });
  });

  test('uses JSON_BODY_LIMIT and URLENCODED_BODY_LIMIT env overrides', () => {
    process.env.JSON_BODY_LIMIT = '1mb';
    process.env.URLENCODED_BODY_LIMIT = '512kb';

    const middlewares = bodyLimits();

    expect(middlewares).toHaveLength(2);
    expect(middlewares[0]).toBe(jsonMw);
    expect(middlewares[1]).toBe(urlMw);

    expect(expressJsonMock).toHaveBeenCalledTimes(1);
    expect(expressJsonMock).toHaveBeenCalledWith({ limit: '1mb' });

    expect(expressUrlencodedMock).toHaveBeenCalledTimes(1);
    expect(expressUrlencodedMock).toHaveBeenCalledWith({
      limit: '512kb',
      extended: true,
    });
  });
});
