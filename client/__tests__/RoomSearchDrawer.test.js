// Polyfill ResizeObserver for JSDOM
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

jest.mock('@mantine/core', () => {
  const React = require('react');

  return {
    __esModule: true,

    MantineProvider: ({ children }) => <>{children}</>,

    Drawer: ({ opened, children }) =>
      opened ? <div>{children}</div> : null,

    TextInput: ({ value, onChange, placeholder, label }) => (
      <label>
        {label}
        <input
          placeholder={placeholder}
          value={value}
          onChange={onChange}
        />
      </label>
    ),

    Stack: ({ children }) => <div>{children}</div>,
    ScrollArea: ({ children }) => <div>{children}</div>,
    Text: ({ children }) => <p>{children}</p>,
    Group: ({ children }) => <div>{children}</div>,
    Badge: ({ children }) => <span>{children}</span>,
    Divider: () => <hr />,

    // IMPORTANT: forward onClick
    Box: ({ children, onClick }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

jest.mock('@/hooks/useIsPremium', () => ({
  __esModule: true,
  default: () => true,
}));

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('@/ads/placements', () => ({
  __esModule: true,
  PLACEMENTS: {
    SEARCH_RESULTS_FOOTER: 'SEARCH_RESULTS_FOOTER',
  },
}));

jest.mock('../src/ads/AdSlot', () => ({
  __esModule: true,
  default: () => null,
}));

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoomSearchDrawer from '../src/components/RoomSearchDrawer.jsx';

beforeEach(() => {
  jest.clearAllMocks();
});

test('searches and renders results; clicking calls onJump', async () => {
  const onJump = jest.fn();
  const onClose = jest.fn();

  const { renderWithRouter } = require('../src/test-utils');

  renderWithRouter(
    <RoomSearchDrawer
      opened
      onClose={onClose}
      roomId={99}
      onJump={onJump}
      messages={[
        {
          id: 1,
          createdAt: '2030-01-01T10:00:00Z',
          decryptedContent: 'hello world',
        },
      ]}
    />
  );

  const user = userEvent.setup();

  await user.type(
    screen.getByPlaceholderText(/search messages/i),
    'hello'
  );

  const resultButton = await screen.findByRole('button', {
    name: /hello world/i,
  });

  await user.click(resultButton);

  expect(onJump).toHaveBeenCalledWith(1);
  expect(onClose).toHaveBeenCalled();
});