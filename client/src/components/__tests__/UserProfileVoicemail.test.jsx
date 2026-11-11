import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@mantine/core', () => {
  const React = require('react');
  const Box = ({ children }) => <div>{children}</div>;
  const Accordion = Object.assign(Box, { Item: Box, Control: Box, Panel: Box });
  const Button = ({ children, onClick }) => <button type="button" onClick={onClick}>{children}</button>;
  const Switch = ({ label, checked, disabled, onChange }) =>
    <label>{label}<input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} /></label>;
  const TextInput = ({ label, value, disabled, onChange }) =>
    <label>{label}<input value={value} disabled={disabled} onChange={onChange} /></label>;
  const NumberInput = ({ label, value, onChange }) =>
    <label>{label}<input value={value} onChange={(event) => onChange?.(event.target.value)} /></label>;
  const Textarea = ({ label, value, onChange }) =>
    <label>{label}<textarea value={value} onChange={onChange} /></label>;
  return {
    MantineProvider: Box, Accordion, Button, Switch, TextInput, NumberInput, Textarea,
    Paper: Box, Title: Box, Stack: Box, Group: Box, Text: Box, FileInput: Box,
    Avatar: Box, Card: Box, Loader: Box, Badge: Box, Alert: Box, Divider: Box,
    Select: Box, MultiSelect: Box,
    useMantineColorScheme: () => ({ setColorScheme: jest.fn() }),
  };
});
import { MantineProvider } from '@mantine/core';

let mockAccount;
const mockPatch = jest.fn();
jest.mock('../../context/UserContext', () => ({
  useUser: () => ({
    currentUser: mockAccount,
    setCurrentUser: (updater) => { mockAccount = updater(mockAccount); },
  }),
}));
jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    defaults: { baseURL: 'http://127.0.0.1.invalid' },
    get: jest.fn(async () => ({ data: {} })),
    patch: (...args) => mockPatch(...args),
  },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key, fallback) => fallback }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn(), useParams: () => ({}) }));
jest.mock('../../i18n', () => ({ __esModule: true, default: { language: 'en', changeLanguage: jest.fn() } }));
jest.mock('../../utils/themeManager', () => ({
  getTheme: () => 'dawn', setTheme: jest.fn(), onThemeChange: () => () => {}, isLightTheme: () => true,
}));
jest.mock('../../utils/favicon', () => ({ setFaviconForTheme: jest.fn() }));
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }));
jest.mock('../LanguageSelector', () => () => null);
jest.mock('../SoundSettings', () => () => null);
jest.mock('../LinkedDevicesPanel', () => () => null);
jest.mock('../../pages/PrivacySection', () => () => null);
jest.mock('../profile/BlockedNumbersPanel', () => () => null);
jest.mock('../profile/BlockedAccountsPanel', () => () => null);
jest.mock('../settings/ThemeSelect.jsx', () => () => null);
jest.mock('../AppAvatar', () => () => null);
jest.mock('../profile/PhoneNumberManager', () => () => null);
jest.mock('../PhoneWarningBanner.jsx', () => () => null);
jest.mock('../security/TwoFASection.jsx', () => () => null);
jest.mock('../security/SecureMessageSettingsCard.jsx', () => () => null);
jest.mock('../../features/settings/ForwardingSettings.jsx', () => () => null);

import UserProfile from '../UserProfile.jsx';

const account = (id, email, enabled) => ({
  id, plan: 'PLUS', canForwardVoicemailEmail: true,
  voicemailEnabled: true, voicemailForwardEmail: email,
  voicemailEmailForwardingEnabled: enabled,
  voicemailGreetingText: '',
});

it('shows saved voicemail preferences after reopening and isolates a switched account', async () => {
  mockAccount = account(1, 'first@example.test', true);
  mockPatch.mockImplementation(async (_url, payload) => ({ data: { ...mockAccount, ...payload } }));
  const view = () => <MantineProvider><UserProfile /></MantineProvider>;
  const rendered = render(view());
  fireEvent.click(screen.getByText('Voicemail'));
  expect(screen.getByLabelText('Forwarding email address')).toHaveValue('first@example.test');
  expect(screen.getByLabelText('Forward voicemail to email')).toBeChecked();

  fireEvent.change(screen.getByLabelText('Forwarding email address'), { target: { value: 'saved@example.test' } });
  fireEvent.click(screen.getByText('Save profile'));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/users/me', expect.objectContaining({
    voicemailForwardEmail: 'saved@example.test', voicemailEmailForwardingEnabled: true,
  })));
  await waitFor(() => expect(mockAccount.voicemailForwardEmail).toBe('saved@example.test'));
  rendered.unmount();
  const reopened = render(view());
  fireEvent.click(screen.getByText('Voicemail'));
  expect(screen.getByLabelText('Forwarding email address')).toHaveValue('saved@example.test');

  mockAccount = account(2, 'second@example.test', false);
  reopened.rerender(view());
  expect(screen.getByLabelText('Forwarding email address')).toHaveValue('second@example.test');
  expect(screen.getByLabelText('Forward voicemail to email')).not.toBeChecked();
});

it('keeps forwarding controls disabled for an ineligible account', async () => {
  mockAccount = { ...account(3, '', false), plan: 'FREE', canForwardVoicemailEmail: false };
  mockPatch.mockClear();
  render(<MantineProvider><UserProfile /></MantineProvider>);
  expect(screen.getByLabelText('Forwarding email address')).toBeDisabled();
  expect(screen.getByLabelText('Forward voicemail to email')).toBeDisabled();
  fireEvent.click(screen.getByText('Save profile'));
  await waitFor(() => expect(mockPatch).toHaveBeenCalled());
  const payload = mockPatch.mock.calls[0][1];
  expect(payload).not.toHaveProperty('voicemailForwardEmail');
  expect(payload).not.toHaveProperty('voicemailEmailForwardingEnabled');
});
