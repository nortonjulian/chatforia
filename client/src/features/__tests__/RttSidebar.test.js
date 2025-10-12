import { render, screen, fireEvent } from '@testing-library/react';
import RttSidebar from './RttSidebar';

describe('RttSidebar', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  const typeMessage = (value) => {
    const input = screen.getByPlaceholderText(/type to speak/i);
    fireEvent.change(input, { target: { value } });
    return input;
  };

  test('renders header and callId', () => {
    render(<RttSidebar callId="abc123" />);
    expect(screen.getByText(/live chat \(rtt\)/i)).toBeInTheDocument();
    expect(screen.getByText(/call abc123/i)).toBeInTheDocument();
  });

  test('sends a message via button click; clears input and shows bubble', () => {
    // stable timestamps for keys
    jest.spyOn(Date, 'now').mockReturnValue(111);

    render(<RttSidebar callId="c1" />);

    typeMessage('Hello there');
    fireEvent.click(screen.getByText(/^send$/i));

    // Bubble appears
    const msg = screen.getByText('Hello there');
    expect(msg).toBeInTheDocument();
    // "me" bubble has dark bg + ml-auto
    expect(msg.className).toMatch(/bg-black/);
    expect(msg.className).toMatch(/text-white/);
    expect(msg.className).toMatch(/ml-auto/);

    // Input cleared
    expect(screen.getByPlaceholderText(/type to speak/i)).toHaveValue('');
  });

  test('sends a message via Enter key', () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(200) // for first message
      .mockReturnValueOnce(201); // for second

    render(<RttSidebar callId="c1" />);

    const input = typeMessage('First');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(input).toHaveValue('');

    // Send second via button to ensure both paths can coexist
    typeMessage('Second');
    fireEvent.click(screen.getByText(/^send$/i));
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  test('does not send empty or whitespace-only messages', () => {
    render(<RttSidebar callId="c1" />);

    const input = typeMessage('   ');
    fireEvent.click(screen.getByText(/^send$/i));
    expect(screen.queryByText('   ')).not.toBeInTheDocument();
    expect(input).toHaveValue('   '); // unchanged since send no-op

    // Press Enter with whitespace
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(screen.queryByText('   ')).not.toBeInTheDocument();
  });
});
