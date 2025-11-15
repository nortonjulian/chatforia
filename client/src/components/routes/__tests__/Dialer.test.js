import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dialer from '../Dialer';

describe('Dialer', () => {
  it('renders header, helper text, input, keypad, and actions', () => {
    render(<Dialer />);
    expect(screen.getByText('Calls')).toBeInTheDocument();
    expect(
      screen.getByText(/Keypad & recents\./i)
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Call' })).toBeInTheDocument();
    // a few keypad buttons
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '*' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#' })).toBeInTheDocument();
    // backspace
    expect(screen.getByRole('button', { name: '⌫' })).toBeInTheDocument();
  });

  it('builds digits when keypad buttons are pressed', async () => {
    const user = userEvent.setup();
    render(<Dialer />);

    const input = screen.getByPlaceholderText('Enter number');
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '3' }));

    expect(input).toHaveValue('123');
  });

  it('supports manual typing into the input', async () => {
    const user = userEvent.setup();
    render(<Dialer />);

    const input = screen.getByPlaceholderText('Enter number');
    await user.type(input, '555');
    expect(input).toHaveValue('555');
  });

  it('backspace removes the last digit', async () => {
    const user = userEvent.setup();
    render(<Dialer />);

    const input = screen.getByPlaceholderText('Enter number');
    await user.click(screen.getByRole('button', { name: '4' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: '6' }));
    expect(input).toHaveValue('456');

    await user.click(screen.getByRole('button', { name: '⌫' }));
    expect(input).toHaveValue('45');
  });

  it('enforces max length of 32 digits when pressing keypad', async () => {
    const user = userEvent.setup();
    render(<Dialer />);

    const input = screen.getByPlaceholderText('Enter number');

    // press '0' forty times; value should cap at 32
    const zeroBtn = screen.getByRole('button', { name: '0' });
    for (let i = 0; i < 40; i++) {
      // eslint-disable-next-line no-await-in-loop
      await user.click(zeroBtn);
    }
    expect(input.value.length).toBe(32);
    expect(input).toHaveValue('0'.repeat(32));
  });

  it('call button is clickable (no crash)', async () => {
    const user = userEvent.setup();
    render(<Dialer />);

    const callBtn = screen.getByRole('button', { name: 'Call' });
    await user.click(callBtn);
    // No state change expected (handler TODO); test ensures no throw.
    expect(callBtn).toBeInTheDocument();
  });
});
