import { resolveSessionSecret } from '../sessionSecret.js';

describe('production browser session secret', () => {
  const jwtSecret = 'j'.repeat(32);
  const valid = 's'.repeat(32);

  test.each([undefined, '', 'change-me', 's'.repeat(31), jwtSecret, ` ${valid}`])(
    'rejects missing, weak, shared or malformed value: %s',
    (secret) => {
      expect(() =>
        resolveSessionSecret({ isProd: true, secret, jwtSecret })
      ).toThrow(/SESSION_SECRET/);
    }
  );

  test('accepts an independent strong production value', () => {
    expect(resolveSessionSecret({ isProd: true, secret: valid, jwtSecret })).toBe(valid);
  });

  test('retains isolated local and test behavior', () => {
    expect(resolveSessionSecret({ isProd: false, jwtSecret })).toBe('change-me');
  });
});
