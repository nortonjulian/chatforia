import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
jest.unmock('react-router-dom');
import { MemoryRouter, Outlet, Route, Routes, Link, useLocation } from 'react-router-dom';
import ChatThreadRoute from '../ChatThreadRoute.jsx';
import { createNativeThreadSessionCache } from '@/utils/nativeThreadSessionCache';

const mockGet = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args) },
}));
jest.mock('@/utils/analytics', () => ({ __esModule: true, default: { capture: jest.fn() } }));
jest.mock('@/components/ChatView.jsx', () => ({
  __esModule: true,
  default: ({ chatroom, nativeThreadCache, onAccessError }) => (
    <div data-testid="chat-view">
      <span>{chatroom.name}</span>
      <span>{nativeThreadCache?.getMessages(chatroom.id)?.[0]?.rawContent}</span>
      <button onClick={() => onAccessError({ response: { status: 403 } })}>Deny messages</button>
    </div>
  ),
}));

const room = (id) => ({ id, name: `Room ${id}`, participants: [{ userId: 1 }] });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function Host({ cache }) {
  const Location = () => <span data-testid="location">{useLocation().pathname}</span>;
  return (
    <MemoryRouter initialEntries={['/chat/1']}>
      <Link to="/chat/1">A</Link><Link to="/chat/2">B</Link>
      <Location />
      <Routes>
        <Route element={<Outlet context={{ currentUser: { id: 1 }, nativeThreadCache: cache }} />}>
          <Route path="/chat/:id" element={<ChatThreadRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => { mockGet.mockReset(); });

test('A → B → A shows a confirmed A snapshot before the return request resolves', async () => {
  const cache = createNativeThreadSessionCache('1:key:key');
  const aReturn = deferred();
  mockGet
    .mockResolvedValueOnce({ data: room(1) })
    .mockResolvedValueOnce({ data: room(2) })
    .mockReturnValueOnce(aReturn.promise);

  render(<Host cache={cache} />);
  expect(await screen.findByText('Room 1')).toBeInTheDocument();
  cache.putMessages(1, [{ id: 11, rawContent: 'Confirmed A' }]);
  fireEvent.click(screen.getByRole('link', { name: 'B' }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/chat/2'));
  expect(await screen.findByText('Room 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'A' }));
  expect(screen.getByText('Room 1')).toBeInTheDocument();
  expect(screen.getByText('Confirmed A')).toBeInTheDocument();
  expect(mockGet).toHaveBeenCalledWith('/chatrooms/1');
  await act(async () => { aReturn.resolve({ data: room(1) }); });
});

test('late response from B cannot replace A after rapid switching', async () => {
  const cache = createNativeThreadSessionCache('1:key:key');
  cache.putRoom(1, room(1));
  cache.putRoom(2, room(2));
  const aFirst = deferred();
  const b = deferred();
  const aReturn = deferred();
  mockGet.mockReturnValueOnce(aFirst.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(aReturn.promise);
  render(<Host cache={cache} />);
  fireEvent.click(screen.getByRole('link', { name: 'B' }));
  fireEvent.click(screen.getByRole('link', { name: 'A' }));
  await act(async () => { b.resolve({ data: room(2) }); aFirst.resolve({ data: room(1) }); });
  expect(screen.getByText('Room 1')).toBeInTheDocument();
  expect(screen.queryByText('Room 2')).not.toBeInTheDocument();
  await act(async () => { aReturn.resolve({ data: room(1) }); });
});

test.each([403, 404])('room %s revocation/error clears the cached view', async (status) => {
  const cache = createNativeThreadSessionCache('1:key:key');
  cache.putRoom(1, room(1));
  cache.putMessages(1, [{ id: 11, rawContent: 'Private A' }]);
  const pending = deferred();
  mockGet.mockReturnValueOnce(pending.promise);
  render(<Host cache={cache} />);
  expect(screen.getByText('Private A')).toBeInTheDocument();
  await act(async () => { pending.reject({ response: { status } }); });
  expect(screen.queryByText('Private A')).not.toBeInTheDocument();
  expect(cache.getRoom(1)).toBeNull();
});

test('an offline room check cannot keep a cached conversation visible past its lifetime', () => {
  let now = 0;
  const cache = createNativeThreadSessionCache('1:key:key', () => now);
  cache.putRoom(1, room(1));
  cache.putMessages(1, [{ id: 11, rawContent: 'Expiring private text' }]);
  mockGet.mockReturnValueOnce(new Promise(() => {}));
  jest.useFakeTimers();
  try {
    render(<Host cache={cache} />);
    expect(screen.getByText('Expiring private text')).toBeInTheDocument();
    act(() => { now = 60_000; jest.advanceTimersByTime(60_000); });
    expect(screen.queryByText('Expiring private text')).not.toBeInTheDocument();
    expect(cache.getMessages(1)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('browser connectivity recovery rechecks the room before showing it again', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: room(1) });
  render(<Host cache={createNativeThreadSessionCache('1:key:key')} />);
  expect(await screen.findByText(/conversation unavailable/i)).toBeInTheDocument();
  act(() => window.dispatchEvent(new Event('online')));
  expect(await screen.findByText('Room 1')).toBeInTheDocument();
  expect(mockGet).toHaveBeenCalledTimes(2);
});

test('membership update hides the snapshot until membership is checked again', async () => {
  const cache = createNativeThreadSessionCache('1:key:key');
  cache.putRoom(1, room(1));
  const initial = deferred();
  const refresh = deferred();
  mockGet.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refresh.promise);
  render(<Host cache={cache} />);
  expect(screen.getByText('Room 1')).toBeInTheDocument();
  act(() => window.dispatchEvent(new CustomEvent('chatroom:updated', { detail: { roomId: 1 } })));
  expect(screen.queryByText('Room 1')).not.toBeInTheDocument();
  expect(cache.getRoom(1)).toBeNull();
  await act(async () => { refresh.reject({ response: { status: 403 } }); initial.resolve({ data: room(1) }); });
  expect(screen.getByText(/conversation unavailable/i)).toBeInTheDocument();
});

test('message authorization error removes the visible room', async () => {
  const cache = createNativeThreadSessionCache('1:key:key');
  cache.putRoom(1, room(1));
  mockGet.mockReturnValueOnce(new Promise(() => {}));
  render(<Host cache={cache} />);
  fireEvent.click(screen.getByRole('button', { name: 'Deny messages' }));
  expect(screen.getByText(/conversation unavailable/i)).toBeInTheDocument();
  expect(cache.getRoom(1)).toBeNull();
});
