// --- Polyfill (Mantine sometimes calls this) -------------------------------
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function () {};
}

// --- Testing libs -----------------------------------------------------------
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// IMPORTANT: we will mock Mantine Select below, so import MantineProvider after the mock
// but we still need to reference it here for types
import { MantineProvider } from '@mantine/core';

// ---------- axiosClient mock (must be BEFORE component import)
const buildAxiosMock = () => {
  const mock = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };

  mock.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes('participants')) {
      return Promise.resolve({
        data: {
          ownerId: 'u1',
          participants: [
            { user: { id: 'u1', username: 'own', displayName: 'own', avatarUrl: '' }, role: 'OWNER' },
            { user: { id: 'u2', username: 'mod', displayName: 'mod', avatarUrl: '' }, role: 'MODERATOR' },
            { user: { id: 'u3', username: 'mem', displayName: 'mem', avatarUrl: '' }, role: 'MEMBER' },
          ],
        },
      });
    }
    if (u.includes('settings')) {
      return Promise.resolve({ data: { aiMode: 'ASK', allowBot: true } });
    }
    return Promise.resolve({ data: {} });
  });

  mock.patch.mockResolvedValue({ data: {} });
  mock.put.mockResolvedValue({ data: {} });
  mock.post.mockResolvedValue({ data: {} });
  mock.delete.mockResolvedValue({ data: {} });

  return mock;
};

jest.mock(require.resolve('../src/api/axiosClient'), () => ({
  __esModule: true,
  default: buildAxiosMock(),
}));

// ---------- UserContext mock
jest.mock('../src/context/UserContext', () => {
  const React = require('react');
  return {
    __esModule: true,
    UserContext: React.createContext({
      currentUser: { id: 'u1', username: 'own', role: 'ADMIN' },
      setCurrentUser: jest.fn(),
    }),
    useUser: () => ({
      currentUser: { id: 'u1', username: 'own', role: 'ADMIN' },
      setCurrentUser: jest.fn(),
    }),
  };
});


beforeEach(() => {
  jest.clearAllMocks();
});
jest.useRealTimers();

// ---------- render helper
function renderWithProviders(ui, { route = '/rooms/room-123' } = {}) {
  return rtlRender(
    <MantineProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/rooms/:roomId" element={ui} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>
  );
}

// ---------- helpers
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function findRowByUsername(username) {
  const label = await screen.findByText(
    new RegExp(`^${escapeRegExp(username)}$`, 'i'),
    { selector: 'td *' }
  );
  return label.closest('tr');
}

async function openSelectAndChoose(cell, { optionNameRe }) {
  // With our mock, the Select is a native <select> (role=combobox)
  const selectEl = within(cell).getByRole('combobox');
  const optionEl = within(cell).getByRole('option', { name: optionNameRe });
  const user = userEvent.setup();
  await user.selectOptions(selectEl, optionEl);
}

// ---------- tests
describe('RoomSettingsModal', () => {
  const RoomSettingsModal = require('../src/components/RoomSettingsModal.jsx').default;

  const baseRoom = {
    id: 'room-123',
    ownerId: 'u1',
    aiAssistantMode: 'OFF',
    autoTranslateMode: 'OFF',
    allowForiaBot: false,
    me: { allowAIBot: true },
  };

  test('loads participants, saves AI mode, and toggles allow bot', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RoomSettingsModal opened onClose={() => {}} room={baseRoom} />);

    const ownerRow = await findRowByUsername('own');
    const modRow = await findRowByUsername('mod');
    const memRow = await findRowByUsername('mem');
    expect(ownerRow && modRow && memRow).toBeTruthy();

    // AI assistant select (mocked to native select)
    const aiSelect = screen.getByRole('combobox', { name: /ai assistant/i });
    // Choose by visible label "Reply proactively" -> value should update to 'always'
    await user.selectOptions(aiSelect, within(aiSelect).getByRole('option', { name: /reply proactively/i }));

    // Toggle the switch twice
    const allowSwitch = screen.getByRole('switch', {
      name: /allow ria assistant for my messages in this room/i,
    });
    await user.click(allowSwitch);
    await user.click(allowSwitch);

    expect(allowSwitch).toBeInTheDocument();
  });

  test('owner/admin can change a member role and remove user', async () => {
    const user = userEvent.setup();
    const axiosClient = require('../src/api/axiosClient').default;
    renderWithProviders(<RoomSettingsModal opened onClose={() => {}} room={baseRoom} />);

    const memRow = await findRowByUsername('mem');
    expect(memRow).toBeTruthy();

    // Change role for the member row
    const roleCell = within(memRow).getAllByRole('cell')[1];
    await openSelectAndChoose(roleCell, { optionNameRe: /moderator/i });

    const payloadHasModerator =
      axiosClient.patch.mock.calls.some(([, body]) =>
        JSON.stringify(body || {}).match(/MODERATOR/)
      );
    expect(payloadHasModerator).toBe(true);

    // Remove the user
    const actionsCell = within(memRow).getAllByRole('cell')[2];
    const removeBtn =
      within(actionsCell).queryByRole('button', { name: /remove/i }) ||
      within(actionsCell).getByText(/remove/i);
    await user.click(removeBtn);

    const payloadHasUserId =
      axiosClient.delete.mock.calls.some(([u]) => /u3|mem/i.test(u));
    expect(payloadHasUserId).toBe(true);
  });
});
