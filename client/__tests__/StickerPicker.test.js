/** @jest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react';

/* ---------------- axiosClient mock ---------------- */
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

/* ---------------- Mantine mocks (minimal) ---------------- */
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Modal = ({ opened, children }) =>
    opened ? <div role="dialog">{children}</div> : null;

  const Tabs = ({ children, value, onChange }) => (
    <div data-tabs data-value={String(value)} data-has-onchange={!!onChange}>
      {children}
    </div>
  );

  Tabs.List = ({ children }) => <div data-tabs-list>{children}</div>;

  Tabs.Tab = ({ children, onClick, value }) => (
    <button type="button" data-tab={value} onClick={onClick}>
      {children}
    </button>
  );

  Tabs.Panel = ({ children, value, ...p }) => (
    <div data-tabs-panel={value} {...p}>
      {children}
    </div>
  );

  const TextInput = ({ placeholder, value, onChange, ...p }) => (
    <input
      placeholder={placeholder}
      value={value ?? ''}
      onChange={onChange}
      {...p}
    />
  );

  const ScrollArea = ({ children, ...p }) => (
    <div data-scrollarea {...p}>
      {children}
    </div>
  );

  const Group = ({ children, ...p }) => <div {...p}>{children}</div>;

  const Box = ({ children, component, ...p }) =>
    component === 'pre' ? (
      <pre {...p}>{children}</pre>
    ) : (
      <div {...p}>{children}</div>
    );

  const Text = ({ children, ...p }) => <span {...p}>{children}</span>;

  const Image = ({ src, alt, ...p }) => <img src={src} alt={alt} {...p} />;

  const Loader = () => <div role="progressbar" />;

  return {
    __esModule: true,
    Modal,
    Tabs,
    TextInput,
    ScrollArea,
    Group,
    Box,
    Text,
    Image,
    Loader,
  };
});

/* ---------------- Emoji-mart mocks ---------------- */
jest.mock('@emoji-mart/data', () => ({ __esModule: true, default: {} }));

jest.mock('@emoji-mart/react', () => ({
  __esModule: true,
  default: () => <div data-testid="emoji-mart-picker" />,
}));

import axiosClient from '@/api/axiosClient';
import StickerPicker from '../src/components/StickerPicker.jsx';

beforeEach(() => {
  jest.clearAllMocks();

  axiosClient.get.mockResolvedValue({
    data: {
      results: [
        {
          id: 'gif1',
          kind: 'GIF',
          url: 'https://giphy.test/full.gif',
          thumb: 'https://giphy.test/thumb.gif',
          mimeType: 'image/gif',
          width: 200,
          height: 100,
          provider: 'giphy',
          providerId: 'gif1',
        },
      ],
    },
  });
});

test('renders GIF picker tab and fetches GIFs from backend when opened on GIFs', async () => {
  const onPick = jest.fn();
  const onClose = jest.fn();

  render(
    <StickerPicker
      opened
      onPick={onPick}
      onClose={onClose}
      initialTab="gifs"
    />
  );

  expect(screen.getByRole('dialog')).toBeInTheDocument();

  const input = screen.getByPlaceholderText(/search gifs/i);
  expect(input).toBeInTheDocument();
  expect(input).toHaveValue('');

  await waitFor(() => {
    expect(axiosClient.get).toHaveBeenCalledWith('/stickers/search', {
      params: {},
    });
  });

  expect(await screen.findByAltText('gif')).toBeInTheDocument();
  expect(screen.getByText(/powered by giphy/i)).toBeInTheDocument();

  expect(onPick).not.toHaveBeenCalled();
});