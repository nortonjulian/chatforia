import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdminRoute from '../AdminRoute';

let mockCurrentUser = null;

jest.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: mockCurrentUser }),
}));

function renderRoute(user) {
  mockCurrentUser = user;

  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <div>Protected Admin Content</div>
            </AdminRoute>
          }
        />
        <Route path="/forbidden" element={<div>Forbidden</div>} />
        <Route path="/" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AdminRoute authorization', () => {
  test('ADMIN can access protected content', () => {
    renderRoute({ id: 1, role: 'ADMIN' });
    expect(screen.getByText('Protected Admin Content')).toBeInTheDocument();
  });

  test('USER cannot access protected content', () => {
    renderRoute({ id: 2, role: 'USER' });
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
    expect(screen.queryByText('Protected Admin Content')).not.toBeInTheDocument();
  });

  test('signed-out visitor is redirected to login', () => {
    renderRoute(null);
    expect(screen.getByText('Login')).toBeInTheDocument();
  });
});
