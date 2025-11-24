import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import ManageWirelessPage from './ManageWireless.jsx';

// Mock child components so we’re just testing the page wiring/structure
jest.mock('../components/wireless/PortNumberForm.jsx', () => () => (
  <div data-testid="mock-port-number-form">Mock PortNumberForm</div>
));

jest.mock('../components/wireless/PortRequestsList.jsx', () => () => (
  <div data-testid="mock-port-requests-list">Mock PortRequestsList</div>
));

describe('ManageWirelessPage', () => {
  const renderPage = () => render(<ManageWirelessPage />);

  test('renders title and intro copy', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Chatforia Wireless' })).toBeInTheDocument();

    expect(
      screen.getByText(
        'Manage your Chatforia mobile plan, numbers, and number porting.'
      )
    ).toBeInTheDocument();
  });

  test('renders port-your-number section and PortNumberForm', () => {
    renderPage();

    // Section header
    expect(
      screen.getByRole('heading', { name: 'Port your existing number' })
    ).toBeInTheDocument();

    // Section description (can match with a substring to be resilient to whitespace)
    expect(
      screen.getByText(/Move your current phone number from your existing carrier into Chatforia./)
    ).toBeInTheDocument();

    // Mocked form component
    expect(screen.getByTestId('mock-port-number-form')).toBeInTheDocument();
  });

  test('renders porting status section and PortRequestsList', () => {
    renderPage();

    // Section header
    expect(
      screen.getByRole('heading', { name: 'Porting status' })
    ).toBeInTheDocument();

    // Section description
    expect(
      screen.getByText('Track the status of your number port requests.')
    ).toBeInTheDocument();

    // Mocked list component
    expect(screen.getByTestId('mock-port-requests-list')).toBeInTheDocument();
  });
});
