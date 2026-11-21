import { PRIVACY_KEY, readPrivacy, savePrivacy } from '../preferences';

beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false }); });
test('defaults off and fails closed on invalid or old data', () => {
  expect(readPrivacy()).toMatchObject({ analytics: false, advertising: false });
  for (const value of ['broken', '{"version":0,"analytics":true}', '{"version":1,"analytics":"true"}']) {
    localStorage.setItem(PRIVACY_KEY, value);
    expect(readPrivacy().analytics).toBe(false);
  }
});
test('persists independent choices and rejects both', () => {
  expect(savePrivacy({ analytics: true, advertising: false })).toBe(true);
  expect(readPrivacy()).toMatchObject({ decided: true, analytics: true, advertising: false });
  savePrivacy({ analytics: false, advertising: false });
  expect(readPrivacy()).toMatchObject({ analytics: false, advertising: false });
});
test('GPC overrides prior and new grants', () => {
  savePrivacy({ analytics: true, advertising: true });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
  expect(readPrivacy()).toMatchObject({ gpc: true, analytics: false, advertising: false });
});
test('blocked storage reports failure', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(savePrivacy({ analytics: true, advertising: true })).toBe(false);
  expect(readPrivacy().analytics).toBe(false);
  spy.mockRestore();
});
