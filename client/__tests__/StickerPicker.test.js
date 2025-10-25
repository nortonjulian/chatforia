/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

/* ---------------- Mantine mocks (minimal) ---------------- */
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Modal = ({ opened, children }) =>
    opened ? <div role="dialog">{children}</div> : null;

  const Tabs = ({ children, value, onChange }) => (
    <div
      data-tabs
      data-value={String(value)}
      data-has-onchange={!!onChange}
    >
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

/* ---------------- Global fetch mock ---------------- */
beforeEach(() => {
  // mock Tenor "featured" fetch that runs on mount
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ results: [] }),
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders GIF picker tab and kicks off Tenor fetch when opened on GIFs', async () => {
  // ✅ Make sure StickerPicker sees a Tenor key at module init
  globalThis.__ENV = { VITE_TENOR_KEY: 'test-key' };

  // Dynamic import AFTER we set __ENV so TENOR_KEY in the module picks it up.
  const { default: StickerPicker } = await import(
    '../src/components/StickerPicker.jsx'
  );

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

  // Modal should render
  expect(screen.getByRole('dialog')).toBeInTheDocument();

  // We should now be in the "canUseTenor === true" branch,
  // so the Tenor search input should show up:
  const input = screen.getByPlaceholderText(/search gifs \(tenor\)…/i);
  expect(input).toBeInTheDocument();
  expect(input).toHaveValue('');

  // Because opened=true and we have a key,
  // the component should have kicked off an initial Tenor "featured" fetch.
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const firstArg = global.fetch.mock.calls[0][0];
  expect(String(firstArg)).toMatch(/tenor/i);
  expect(String(firstArg)).toMatch(/featured/i);

  // sanity: no sticker picked yet
  expect(onPick).not.toHaveBeenCalled();
});
