import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { toE164Dev } from '../src/utils/phoneLocalDev';
import StartChatModal from '../src/components/StartChatModal.jsx';

// --- Stub ContactList to avoid extra network/portals during these tests
jest.mock('../src/components/ContactList.jsx', () => ({
  __esModule: true,
  default: function ContactListStub() {
    return null;
  },
}));

// --- axiosClient mock (top-level)
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    post: (...a) => mockPost(...a),
    patch: (...a) => mockPatch(...a),
    delete: (...a) => mockDelete(...a),
  },
}));

// --- Local render helper: Mantine + Router
function renderWithProviders(ui) {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={ui} />
          {/* Route used by navigate(`/chat/:id`) in StartChatModal */}
          <Route path="/chat/:id" element={<div>Chat Page</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Initial contacts load in useEffect: GET /contacts/:id
  mockGet.mockResolvedValueOnce({ data: [] });
});

test('searches users, saves contact and starts chat', async () => {
  const user = userEvent.setup();

  // Next calls in order:
  // 1) GET /users/search
  mockGet.mockResolvedValueOnce({ data: [{ id: 2, username: 'alice' }] });
  // 2) POST /contacts (save)
  mockPost.mockResolvedValueOnce({ data: {} });
  // 3) GET /contacts/:id (refresh)
  mockGet.mockResolvedValueOnce({ data: [{ userId: 2, alias: '' }] });
  // 4) POST /chatrooms/direct/2
  mockPost.mockResolvedValueOnce({ data: { id: 123 } });

  const onClose = jest.fn();
  renderWithProviders(<StartChatModal currentUserId={1} onClose={onClose} />);

  await user.type(
    screen.getByPlaceholderText(/search by username or phone/i),
    'alice'
  );
  await user.click(screen.getByRole('button', { name: /search/i }));

  await waitFor(() =>
    expect(mockGet).toHaveBeenCalledWith('/users/search', {
      params: { query: 'alice' },
    })
  );

  expect(await screen.findByText(/alice/i)).toBeInTheDocument();

  // Click the "Save" button in the result card (not "Save Contact")
  await user.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith('/contacts', {
      ownerId: 1,
      userId: 2,
      alias: undefined,
    })
  );

  // Start chat → POST /chatrooms/direct/2 → navigate → onClose called
  await user.click(screen.getByRole('button', { name: /^start$/i }));
  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith('/chatrooms/direct/2')
  );
  expect(onClose).toHaveBeenCalled();
});

test('Add Contact (direct) path falls back to external contact', async () => {
  const user = userEvent.setup();

  // Calls in order for add-contact-direct:
  mockGet.mockResolvedValueOnce({ data: [] }); // 1) GET /users/search (no existing user)
  mockPost.mockResolvedValueOnce({});          // 2) POST /contacts (external)
  mockPost.mockResolvedValueOnce({});          // 3) POST /invites (fire-and-forget)
  mockGet.mockResolvedValueOnce({ data: [] }); // 4) GET /contacts (refresh)

  renderWithProviders(<StartChatModal currentUserId={1} onClose={() => {}} />);

  await user.click(screen.getByRole('button', { name: /add/i }));
  await user.type(screen.getByPlaceholderText(/^username or phone$/i), '555-555-5555');
  await user.type(screen.getByPlaceholderText(/^alias \(optional\)$/i), 'Bob');
  await user.click(screen.getByRole('button', { name: /save contact/i }));

  const expectedPhone = toE164Dev('555-555-5555', 'US'); // => '+15555555555'

  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith(
      '/contacts',
      expect.objectContaining({
        ownerId: 1,
        externalPhone: expectedPhone,
        externalName: 'Bob',
        alias: 'Bob',
      })
    )
  );

  expect(mockPost).toHaveBeenCalledWith('/invites', {
    phone: expectedPhone,
    name: 'Bob',
  });
});

