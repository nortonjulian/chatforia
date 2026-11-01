import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Footer from '../Footer';

let mockCurrentUser = null;

jest.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: mockCurrentUser }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback) => fallback || _key,
  }),
}));

function renderFooter(user) {
  mockCurrentUser = user;

  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>
  );
}

describe('Footer access and social links', () => {
  test('ADMIN sees dashboard link', () => {
    renderFooter({ id: 1, role: 'ADMIN' });
    expect(screen.getByRole('link', { name: 'Admin Dashboard' }))
      .toHaveAttribute('href', '/admin');
  });

  test('USER does not see dashboard link', () => {
    renderFooter({ id: 2, role: 'USER' });
    expect(screen.queryByRole('link', { name: 'Admin Dashboard' }))
      .not.toBeInTheDocument();
  });

  test('signed-out visitor does not see dashboard link', () => {
    renderFooter(null);
    expect(screen.queryByRole('link', { name: 'Admin Dashboard' }))
      .not.toBeInTheDocument();
  });

  test('social links match official destinations', () => {
    renderFooter(null);

    const expected = {
      TikTok: 'https://tiktok.com/@chatforia',
      Instagram: 'https://instagram.com/getchatforia',
      LinkedIn: 'https://linkedin.com/company/chatforia',
      'X (Twitter)': 'https://x.com/chatforia',
      Reddit: 'https://www.reddit.com/user/Chatforia/',
    };

    for (const [name, href] of Object.entries(expected)) {
      expect(screen.getByRole('link', { name }))
        .toHaveAttribute('href', href);
    }

    expect(screen.queryByRole('link', { name: 'Facebook' }))
      .not.toBeInTheDocument();
  });

  test('copyright uses Chatforia LLC', () => {
    renderFooter(null);
    expect(screen.getByText(/Chatforia LLC\. All rights reserved/))
      .toBeInTheDocument();
  });
});
