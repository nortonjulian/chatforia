import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import ManageWirelessPage from '../ManageWireless.jsx';

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

describe('ManageWirelessPage', () => {
  const renderPage = () => render(<ManageWirelessPage />);

  test('renders title and intro copy', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { name: 'Chatforia Wireless' })
    ).toBeInTheDocument();

    expect(
      screen.getByText('Manage your Chatforia mobile plan and eSIM.')
    ).toBeInTheDocument();
  });

  test('renders on-the-go wireless section', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { name: 'Use Chatforia on the go' })
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        'Get mobile data for Chatforia when you are away from Wi-Fi.'
      )
    ).toBeInTheDocument();
  });

  test('renders Chatforia eSIM section', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { name: 'Chatforia eSIM' })
    ).toBeInTheDocument();

    expect(
      screen.getByText('Activate and manage your Chatforia data service.')
    ).toBeInTheDocument();
  });
});