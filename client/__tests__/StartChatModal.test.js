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

// --- Stub RecipientSelector so we can add recipients in tests
jest.mock('../src/components/RecipientSelector.jsx', () => ({
  __esModule: true,
  default: function RecipientSelectorStub(props) {
    // Minimal stub to let tests "add" recipients
    const add = (id, display = 'user') => {
      const next = Array.isArray(props.value) ? [...props.value] : [];
      if (!next.find((r) => r.id === id)) next.push({ id, display, type: 'user' });
      props.onChange?.(next);
    };
    const clear = () => props.onChange?.([]);
    return (
      <div>
        <button type="button" onClick={() => add(2, 'alice')}>
          Add Alice
        </button>
        <button type="button" onClick={() => add(3, 'bob')}>
          Add Bob
        </button>
        <button type="button" onClick={clear}>
          Clear Recipients
        </button>
      </div>
    );
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
          <Route path="/" element={<div>Inbox</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Initial contacts load in useEffect: GET /contacts
  mockGet.mockResolvedValueOnce({ data: [] });
});

test('searches users, saves contact and starts chat', async () => {
  const user = userEvent.setup();

  // Next calls in order:
  // 1) GET /users/search
  mockGet.mockResolvedValueOnce({ data: [{ id: 2, username: 'alice' }] });
  // 2) POST /contacts (save)
  mockPost.mockResolvedValueOnce({ data: {} });
  // 3) GET /contacts (refresh)
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

  // Calls in order for add-contact-direct (phone-based path):
  // 1) POST /contacts (external)
  // 2) POST /invites (fire-and-forget)
  // 3) GET /contacts (refresh)
  mockPost.mockResolvedValueOnce({});          // POST /contacts (external)
  mockPost.mockResolvedValueOnce({});          // POST /invites
  mockGet.mockResolvedValueOnce({ data: [] }); // GET /contacts (refresh)

  renderWithProviders(<StartChatModal currentUserId={1} onClose={() => {}} />);

  // Open "Add a Contact"
  await user.click(screen.getByRole('button', { name: /add/i }));

  // Enter phone via PhoneField (label-based)
  const rawPhone = '555-555-5555';
  const expectedPhone = toE164Dev(rawPhone, 'US'); // => '+15555555555'
  await user.type(screen.getByLabelText(/phone \(optional\)/i), expectedPhone);

  // Optionally fill alias in the "Alias (optional)" field
  await user.type(
    screen.getByPlaceholderText(/^alias \(optional\)$/i),
    'Bob'
  );

  // Save contact (external contact path)
  await user.click(screen.getByRole('button', { name: /save contact/i }));

  await waitFor(() =>
    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      '/contacts',
      expect.objectContaining({
        ownerId: 1,
        externalPhone: expectedPhone,
        externalName: 'Bob',
        alias: 'Bob',
      })
    )
  );

  // Invite fired
  expect(mockPost).toHaveBeenNthCalledWith(2, '/invites', {
    phone: expectedPhone,
    name: 'Bob',
  });

  // Contacts refreshed
  await waitFor(() =>
    expect(mockGet).toHaveBeenLastCalledWith('/contacts', {
      params: { limit: 50 },
    })
  );
});

test('creates a group chat with two recipients', async () => {
  const user = userEvent.setup();

  // Group path: POST /chatrooms → returns { id }
  mockPost.mockResolvedValueOnce({ data: { id: 777 } });

  const onClose = jest.fn();
  renderWithProviders(<StartChatModal currentUserId={1} onClose={onClose} />);

  // Add two recipients via RecipientSelector stub
  await user.click(screen.getByRole('button', { name: /add alice/i }));
  await user.click(screen.getByRole('button', { name: /add bob/i }));

  // Button label in Group mode is "Create group"
  const createGroupBtn = screen.getByRole('button', { name: /create group/i });
  expect(createGroupBtn).toBeEnabled();

  await user.click(createGroupBtn);

  // Expect POST /chatrooms with participantIds [2,3]
  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith('/chatrooms', {
      participantIds: [2, 3],
      title: undefined,
    })
  );

  // Modal closed (navigate to /chat/777 handled by router)
  expect(onClose).toHaveBeenCalled();
});

test('sends a broadcast with seed message (server /broadcasts path)', async () => {
  const user = userEvent.setup();

  // Broadcast path: POST /broadcasts → returns createdRoomIds
  mockPost.mockResolvedValueOnce({ data: { createdRoomIds: ['r1', 'r2'] } });

  const onClose = jest.fn();
  renderWithProviders(<StartChatModal currentUserId={1} onClose={onClose} />);

  // Switch to Broadcast mode
  await user.click(screen.getByRole('radio', { name: /broadcast/i }));

  // Add two recipients
  await user.click(screen.getByRole('button', { name: /add alice/i }));
  await user.click(screen.getByRole('button', { name: /add bob/i }));

  // Type first message
  await user.type(
    screen.getByLabelText(/first message \(optional but recommended\)/i),
    'Hello everyone!'
  );

  // Send broadcast
  const sendBtn = screen.getByRole('button', { name: /send broadcast/i });
  await user.click(sendBtn);

  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith('/broadcasts', {
      participantIds: [2, 3],
      message: 'Hello everyone!',
    })
  );

  expect(onClose).toHaveBeenCalled();
});

test('broadcast fallback: creates individual rooms and seeds message when /broadcasts is unavailable', async () => {
  const user = userEvent.setup();

  // First POST /broadcasts → throw (unavailable)
  mockPost.mockRejectedValueOnce(new Error('no /broadcasts'));
  // Then loop:
  // - POST /chatrooms (for user 2) → { id: 'room-2' }
  // - POST /messages (seed) for room-2
  // - POST /chatrooms (for user 3) → { id: 'room-3' }
  // - POST /messages (seed) for room-3
  mockPost.mockResolvedValueOnce({ data: { id: 'room-2' } }); // chatrooms for 2
  mockPost.mockResolvedValueOnce({ data: {} });               // messages for room-2
  mockPost.mockResolvedValueOnce({ data: { id: 'room-3' } }); // chatrooms for 3
  mockPost.mockResolvedValueOnce({ data: {} });               // messages for room-3

  const onClose = jest.fn();
  renderWithProviders(<StartChatModal currentUserId={1} onClose={onClose} />);

  // Switch to Broadcast mode
  await user.click(screen.getByRole('radio', { name: /broadcast/i }));

  // Add two recipients
  await user.click(screen.getByRole('button', { name: /add alice/i }));
  await user.click(screen.getByRole('button', { name: /add bob/i }));

  // Seed message
  await user.type(
    screen.getByLabelText(/first message \(optional but recommended\)/i),
    'Heads up!'
  );

  // Send broadcast
  await user.click(screen.getByRole('button', { name: /send broadcast/i }));

  // 1) Tried /broadcasts first
  await waitFor(() =>
    expect(mockPost).toHaveBeenNthCalledWith(1, '/broadcasts', {
      participantIds: [2, 3],
      message: 'Heads up!',
    })
  );

  // 2) Fallback: per-user /chatrooms then /messages
  // For user 2
  expect(mockPost).toHaveBeenNthCalledWith(2, '/chatrooms', {
    participantIds: [2],
  });
  // seed message to room-2
  expect(mockPost).toHaveBeenNthCalledWith(3, '/messages', {
    chatRoomId: 'room-2',
    text: 'Heads up!',
  });

  // For user 3
  expect(mockPost).toHaveBeenNthCalledWith(4, '/chatrooms', {
    participantIds: [3],
  });
  // seed message to room-3
  expect(mockPost).toHaveBeenNthCalledWith(5, '/messages', {
    chatRoomId: 'room-3',
    text: 'Heads up!',
  });

  expect(onClose).toHaveBeenCalled();
});
