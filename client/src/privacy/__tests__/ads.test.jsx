import React from 'react';
import { render, cleanup } from '@testing-library/react';
import AdSenseAutoAds from '../../ads/AdSenseAutoAds';
import { savePrivacy } from '../preferences';

jest.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/about' }) }));
jest.mock('@/context/UserContext', () => ({ useUser: () => ({ currentUser: null, authLoading: false }) }));
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false });
});
afterEach(() => { cleanup(); document.querySelectorAll('script[data-chatforia-adsense]').forEach(s => s.remove()); });
test('does not insert an advertising script without consent', () => {
  render(<AdSenseAutoAds />);
  expect(document.querySelector('script[data-chatforia-adsense]')).toBeNull();
});
test('inserts only one script with advertising consent', () => {
  savePrivacy({ advertising: true });
  render(<><AdSenseAutoAds /><AdSenseAutoAds /></>);
  expect(document.querySelectorAll('script[data-chatforia-adsense]')).toHaveLength(1);
});
test('GPC prevents insertion despite prior advertising consent', () => {
  savePrivacy({ advertising: true });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
  render(<AdSenseAutoAds />);
  expect(document.querySelector('script[data-chatforia-adsense]')).toBeNull();
});
