import { render, screen } from '@testing-library/react';
import VoicemailPage from '../VoicemailPage.jsx';

// Mock i18next
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key) => key, // just echo the key
  }),
}));

// Mock VoicemailList so we don't pull in its whole behavior
jest.mock('../../components/voicemail/VoicemailList.jsx', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="voicemail-list">VoicemailList mock</div>
  ),
}));

describe('VoicemailPage', () => {
  test('renders page title and voicemail list', () => {
    render(<VoicemailPage />);

    // Header title uses the translation key
    expect(screen.getByText('voicemail.pageTitle')).toBeInTheDocument();

    // VoicemailList is present
    expect(screen.getByTestId('voicemail-list')).toBeInTheDocument();
  });
});
