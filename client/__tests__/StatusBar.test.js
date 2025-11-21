import { act } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import StatusBar from '../src/components/StatusBar';

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../src/utils/encryptionClient', () => ({
  __esModule: true,
  decryptFetchedMessages: jest.fn(),
}));

// --- SocketContext mock with shared mockSocket and handlers ---
const socketHandlers = {};
const mockSocket = {
  on: jest.fn((event, cb) => {
    socketHandlers[event] = cb;
  }),
  off: jest.fn((event, cb) => {
    if (socketHandlers[event] === cb) {
      delete socketHandlers[event];
    }
  }),
};

jest.mock('../src/context/SocketContext', () => ({
  __esModule: true,
  useSocket: () => ({ socket: mockSocket }),
}));

import axiosClient from '../src/api/axiosClient';
import { decryptFetchedMessages } from '../src/utils/encryptionClient';

const FEED = [
  {
    id: 's1',
    author: { id: 'u1', username: 'alice', avatarUrl: '/a.png' },
    captionCiphertext: 'c1',
    encryptedKeyForMe: 'ek1',
    viewerSeen: false,
    assets: [],
  },
  {
    id: 's2',
    author: { id: 'u1', username: 'alice', avatarUrl: '/a.png' },
    captionCiphertext: 'c2',
    encryptedKeyForMe: 'ek2',
    viewerSeen: true,
    assets: [],
  },
  {
    id: 's3',
    author: { id: 'u2', username: 'bob', avatarUrl: '/b.png' },
    captionCiphertext: 'c3',
    encryptedKeyForMe: 'ek3',
    viewerSeen: true,
    assets: [],
  },
];

describe('StatusBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // also clear handlers between tests
    Object.keys(socketHandlers).forEach((k) => delete socketHandlers[k]);
  });

  test('loads, decrypts, groups by author, renders tooltips', async () => {
    axiosClient.get.mockResolvedValueOnce({ data: FEED });
    decryptFetchedMessages.mockResolvedValueOnce([
      { id: 's1', decryptedContent: 'hello 1' },
      { id: 's2', decryptedContent: 'hello 2' },
      { id: 's3', decryptedContent: 'hello 3' },
    ]);

    render(<StatusBar currentUserId="me" onOpenViewer={jest.fn()} />);

    expect(await screen.findByText(/Loading status/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
      expect(screen.getByText('bob')).toBeInTheDocument();
    });

    // Tooltips: we only assert presence of the authors; the tooltip text is
    // provided via label, but we don't need to assert that here.
  });

  test('clicking author calls onOpenViewer with grouped stories', async () => {
    axiosClient.get.mockResolvedValue({ data: FEED });
    decryptFetchedMessages.mockResolvedValue([
      { id: 's1', decryptedContent: 'hello 1' },
      { id: 's2', decryptedContent: 'hello 2' },
      { id: 's3', decryptedContent: 'hello 3' },
    ]);

    const onOpenViewer = jest.fn();
    render(<StatusBar currentUserId="me" onOpenViewer={onOpenViewer} />);

    await screen.findByText('alice');

    fireEvent.click(screen.getByText('alice'));
    expect(onOpenViewer).toHaveBeenCalledTimes(1);
    const { author, stories } = onOpenViewer.mock.calls[0][0];
    expect(author.username).toBe('alice');
    expect(stories).toHaveLength(2);
  });

  test('reloads on socket events', async () => {
    axiosClient.get.mockResolvedValue({ data: FEED });
    decryptFetchedMessages.mockResolvedValue([
      { id: 's1', decryptedContent: 'hello 1' },
      { id: 's2', decryptedContent: 'hello 2' },
      { id: 's3', decryptedContent: 'hello 3' },
    ]);

    render(<StatusBar currentUserId="me" />);

    await screen.findByText('alice');

    // ensure handlers were registered
    expect(mockSocket.on).toHaveBeenCalledWith(
      'status_posted',
      expect.any(Function)
    );
    expect(mockSocket.on).toHaveBeenCalledWith(
      'status_expired',
      expect.any(Function)
    );

    // Trigger the posted handler we captured in socketHandlers
    axiosClient.get.mockResolvedValueOnce({ data: [] });
    decryptFetchedMessages.mockResolvedValueOnce([]);

    const onPosted = socketHandlers['status_posted'];

    await act(async () => {
      onPosted && onPosted();
    });

    await waitFor(() => {
      expect(screen.queryByText('alice')).not.toBeInTheDocument();
    });
  });
});
