import { render, screen, fireEvent } from '@testing-library/react';

// ---- Mantine stubs (lightweight) ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (testid) => ({ children, ...props }) => (
    <div data-testid={testid} {...props}>{children}</div>
  );
  const Button = ({ children, onClick, ...rest }) => (
    <button data-testid="button" onClick={onClick} {...rest}>
      {children}
    </button>
  );
  return {
    __esModule: true,
    Box: passthru('box'),
    Card: passthru('card'),
    Stack: passthru('stack'),
    Text: passthru('text'),
    Button,
  };
});

// SUT (corrected path)
import HomeIndex from '../../features/chat/HomeIndex';

describe('HomeIndex', () => {
  test('renders headline, subtext, and button; clicking dispatches open-new-chat-modal', () => {
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(<HomeIndex />);

    // Headline and subtext from the component
    expect(screen.getByText(/your messages/i)).toBeInTheDocument();
    expect(screen.getByText(/send a message to start a chat\./i)).toBeInTheDocument();

    // Button & click -> dispatch CustomEvent
    const btn = screen.getByTestId('button');
    expect(btn).toHaveTextContent(/send message/i);

    fireEvent.click(btn);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const eventArg = dispatchSpy.mock.calls[0][0];
    expect(eventArg).toBeInstanceOf(CustomEvent);
    expect(eventArg.type).toBe('open-new-chat-modal');

    dispatchSpy.mockRestore();
  });
});
