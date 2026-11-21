const mockPh = { init: jest.fn(), opt_in_capturing: jest.fn(), opt_out_capturing: jest.fn(), capture: jest.fn(), identify: jest.fn() };
jest.mock('posthog-js', () => ({ __esModule: true, default: mockPh }));
let analytics, preferences;
beforeEach(() => {
  jest.resetModules(); jest.clearAllMocks(); localStorage.clear();
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false });
  process.env.VITE_POSTHOG_KEY = 'test';
  preferences = require('../preferences');
  analytics = require('../../utils/analytics').default;
});
test('does not initialize, identify or capture before consent', async () => {
  await analytics.capture('private'); await analytics.identify('123');
  expect(mockPh.init).not.toHaveBeenCalled(); expect(mockPh.capture).not.toHaveBeenCalled(); expect(mockPh.identify).not.toHaveBeenCalled();
});
test('permits granted events then stops on withdrawal', async () => {
  preferences.savePrivacy({ analytics: true }); await analytics.capture('allowed');
  expect(mockPh.capture).toHaveBeenCalledWith('allowed');
  preferences.savePrivacy({ analytics: false }); await analytics.capture('blocked');
  expect(mockPh.opt_out_capturing).toHaveBeenCalled();
  expect(mockPh.capture).toHaveBeenCalledTimes(1);
});
test('GPC prevents SDK initialization even with saved consent', async () => {
  preferences.savePrivacy({ analytics: true });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
  await analytics.capture('blocked'); expect(mockPh.init).not.toHaveBeenCalled();
});
