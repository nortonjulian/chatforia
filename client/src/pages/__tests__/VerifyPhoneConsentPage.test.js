import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import VerifyPhoneConsentPage from '../VerifyPhoneConsentPage';

test('retired signup step redirects to registration', () => {
  const { getByText } = render(
    <MemoryRouter initialEntries={['/retired']}>
      <Routes>
        <Route path="/retired" element={<VerifyPhoneConsentPage />} />
        <Route path="/register" element={<p>Registration screen</p>} />
      </Routes>
    </MemoryRouter>
  );
  expect(getByText('Registration screen')).toBeInTheDocument();
});
