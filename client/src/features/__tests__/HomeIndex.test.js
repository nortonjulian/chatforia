/** @jest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react';

// ---- Mantine stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const passthruDiv = (testid) =>
    ({ children, ...props }) => (
      <div data-testid={testid} {...props}>
        {children}
      </div>
    );

  const passthruSpan = (testid) =>
    ({ children, ...props }) => (
      <span data-testid={testid} {...props}>
        {children}
      </span>
    );

  const Button = ({ children, onClick, ...rest }) => (
    <button
      type="button"
      data-testid="button"
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );

  const ActionIcon = ({ children, onClick, ...rest }) => (
    <button
      type="button"
      data-testid="action-icon"
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );

  const TextInput = ({
    value,
    onChange,
    placeholder,
    'aria-label': ariaLabel,
    onKeyDown,
    ...rest
  }) => (
    <input
      data-testid="text-input"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      {...rest}
    />
  );

  const Tooltip = ({ children, label, ...rest }) => (
    <div data-testid="tooltip" data-label={label} {...rest}>
      {children}
    </div>
  );

  const Group = passthruDiv('group');
  const Box = passthruDiv('box');
  const Card = passthruDiv('card');
  const Stack = passthruDiv('stack');
  const Text = passthruSpan('text');

  return {
    __esModule: true,
    Box,
    Card,
    Stack,
    Text,
    Button,
    TextInput,
    Group,
    ActionIcon,
    Tooltip,
  };
});

// ---- lucide-react stubs ----
jest.mock('lucide-react', () => ({
  __esModule: true,
  Smile: (props) => <i data-icon="smile" {...props} />,
  Image: (props) => <i data-icon="image" {...props} />,
  ImageIcon: (props) => <i data-icon="image" {...props} />,
  Send: (props) => <i data-icon="send" {...props} />,
}));

// ---- StickerPicker stub ----
jest.mock('@/components/StickerPicker.jsx', () => ({
  __esModule: true,
  default: ({ opened, initialTab }) => (
    <div
      data-testid="sticker-picker"
      data-opened={opened ? 'true' : 'false'}
      data-tab={initialTab}
    />
  ),
}));

// ---- SUT ----
import HomeIndex from '../../features/chat/HomeIndex';

describe('HomeIndex', () => {
  test('renders headline, subtext, and button; clicking dispatches open-new-chat-modal', () => {
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(<HomeIndex />);

    // headline + subtext visible
    expect(
      screen.getByText(/your messages/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(/send a message to start a chat\./i)
    ).toBeInTheDocument();

    // grab the "Send message" CTA
    const ctaButton = screen.getByRole('button', {
      name: /send message/i,
    });
    expect(ctaButton).toBeInTheDocument();

    // type a message so handleSendMessage will actually dispatch
    const composerInput = screen.getByLabelText(
      /message composer/i
    );
    fireEvent.change(composerInput, {
      target: { value: 'hello world' },
    });

    // click CTA
    fireEvent.click(ctaButton);

    // assert dispatch happened
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const evt = dispatchSpy.mock.calls[0][0];
    expect(evt).toBeInstanceOf(CustomEvent);
    expect(evt.type).toBe('open-new-chat-modal');

    dispatchSpy.mockRestore();
  });
});
