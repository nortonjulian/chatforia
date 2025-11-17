import { jest } from '@jest/globals';
import { normalizeLoginBody } from '../normalizeLoginBody.js';

function makeReq(body) {
  return { body: { ...body } };
}

describe('normalizeLoginBody middleware', () => {
  it('prefers body.identifier over username/email and trims it', () => {
    const req = makeReq({
      identifier: '  myUser  ',
      username: 'shouldNotUse',
      email: 'also@ignore.com',
      password: 'secret',
    });
    const next = jest.fn();

    normalizeLoginBody(req, {}, next);

    expect(req.body).toEqual({
      identifier: 'myUser',
      password: 'secret',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('falls back to username when identifier is missing', () => {
    const req = makeReq({
      username: '  userNameOnly ',
      email: 'user@example.com',
      password: 'pw',
    });
    const next = jest.fn();

    normalizeLoginBody(req, {}, next);

    expect(req.body).toEqual({
      identifier: 'userNameOnly',
      password: 'pw',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('falls back to email when identifier and username are missing', () => {
    const req = makeReq({
      email: '  user@example.com ',
      password: 'pw',
    });
    const next = jest.fn();

    normalizeLoginBody(req, {}, next);

    expect(req.body).toEqual({
      identifier: 'user@example.com',
      password: 'pw',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses empty string when identifier/username/email are all missing', () => {
    const req = makeReq({
      password: 'pw',
    });
    const next = jest.fn();

    normalizeLoginBody(req, {}, next);

    expect(req.body).toEqual({
      identifier: '',
      password: 'pw',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('coerces password to string and handles missing password', () => {
    const req = makeReq({
      identifier: 'user',
      password: 123456,
    });
    const next = jest.fn();

    normalizeLoginBody(req, {}, next);

    expect(req.body).toEqual({
      identifier: 'user',
      password: '123456',
    });

    const req2 = makeReq({
      identifier: 'user2',
      // no password field
    });
    const next2 = jest.fn();

    normalizeLoginBody(req2, {}, next2);

    expect(req2.body).toEqual({
      identifier: 'user2',
      password: '',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next2).toHaveBeenCalledTimes(1);
  });

  it('handles missing req.body gracefully', () => {
    const req = { }; // no body
    const next = jest.fn();

    normalizeLoginBody(req, {}, next);

    expect(req.body).toEqual({
      identifier: '',
      password: '',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
