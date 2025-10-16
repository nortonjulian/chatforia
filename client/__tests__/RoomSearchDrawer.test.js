// Polyfill ResizeObserver for JSDOM
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// ---- Mocks added to avoid importing Vite-specific axiosClient via hooks ----
jest.mock('@/hooks/useIsPremium', () => ({
  __esModule: true,
  default: () => true, // or false; not important for this test
}));

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// Ads (keep UI simple, avoid extra imports)
jest.mock('@/ads/placements', () => ({
  __esModule: true,
  PLACEMENTS: { SEARCH_RESULTS_FOOTER: 'SEARCH_RESULTS_FOOTER' },
}));
jest.mock('../src/ads/AdSlot', () => ({
  __esModule: true,
  default: () => null,
}));

// messagesStore: avoid out-of-scope variable in factory
jest.mock('../src/utils/messagesStore', () => ({
  __esModule: true,
  searchRoom: jest.fn(),
}));

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { searchRoom as searchRoomMock } from '../src/utils/messagesStore';
import RoomSearchDrawer from '../src/components/RoomSearchDrawer.jsx';

beforeEach(() => {
  jest.clearAllMocks();

  // Always return a match when query has non-whitespace
  searchRoomMock.mockImplementation((_roomId, q) =>
    Promise.resolve(
      q && q.trim()
        ? [{ id: 1, createdAt: '2030-01-01T10:00:00Z', decryptedContent: 'hello world' }]
        : []
    )
  );
});

test('searches and renders results; clicking calls onJump', async () => {
  const onJump = jest.fn();
  const { renderWithRouter } = require('../src/test-utils');

  renderWithRouter(
    <RoomSearchDrawer opened onClose={() => {}} roomId={99} onJump={onJump} />
  );

  await userEvent.type(
    screen.getByPlaceholderText(/search messages/i),
    'hello'
  );

  // Ensure the last call was made with the final query
  await waitFor(() =>
    expect(searchRoomMock).toHaveBeenCalledWith(99, expect.stringContaining('hello'))
  );

  // Wait for the result to render
  await waitFor(() =>
    expect(screen.getByText(/hello world/i)).toBeInTheDocument()
  );

  await userEvent.click(screen.getByText(/hello world/i));
  expect(onJump).toHaveBeenCalledWith(1);
});
