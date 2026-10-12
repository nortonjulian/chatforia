import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GlobalPeopleSearch from '@/components/GlobalPeopleSearch';

jest.mock('@mantine/core', () => {
  const React = require('react');
  const TextInput = ({ value, onChange, onKeyDown, placeholder, 'aria-label': aria, style }) => (
    <input
      placeholder={placeholder}
      aria-label={aria}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      style={style}
    />
  );
  const Button = ({ children, onClick, 'aria-label': aria, style }) => (
    <button type="button" aria-label={aria} onClick={onClick} style={style}>
      {children}
    </button>
  );
  return { __esModule: true, TextInput, Button };
});

jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconSearch: (props) => <span data-testid="icon-search" {...props} />,
}));

global.mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => global.mockNavigate,
}));

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));
import axiosClient from '@/api/axiosClient';

beforeEach(() => {
  jest.clearAllMocks();
  global.mockNavigate.mockReset();
});

function typeInSearch(value) {
  const input = screen.getByLabelText(/global people search/i);
  fireEvent.change(input, { target: { value } });
  return input;
}

describe('GlobalPeopleSearch', () => {
  test('respects layout props', () => {
    const { container, rerender } = render(<GlobalPeopleSearch />);
    const outer = container.querySelector('div');
    const inner = outer.querySelector('div');
    expect(outer.style.justifyContent).toBe('flex-start');
    expect(inner.style.maxWidth).toBe('640px');

    rerender(<GlobalPeopleSearch align="center" maxWidth={720} />);
    const outer2 = container.querySelector('div');
    const inner2 = outer2.querySelector('div');
    expect(outer2.style.justifyContent).toBe('center');
    expect(inner2.style.maxWidth).toBe('720px');
  });

  test('does nothing on empty or whitespace-only query', () => {
    render(<GlobalPeopleSearch />);
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(global.mockNavigate).not.toHaveBeenCalled();

    typeInSearch('   ');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(global.mockNavigate).not.toHaveBeenCalled();
    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  test('name search always routes to explicit results selection', () => {
    render(<GlobalPeopleSearch />);
    typeInSearch('  John Smith  ');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    expect(axiosClient.get).not.toHaveBeenCalled();
    expect(axiosClient.post).not.toHaveBeenCalled();
    expect(global.mockNavigate).toHaveBeenCalledWith('/people?q=John%20Smith');
  });

  test('raw phone number can still start an SMS thread directly', async () => {
    render(<GlobalPeopleSearch />);
    axiosClient.post.mockResolvedValueOnce({ data: { id: 'thread-7' } });

    typeInSearch('+1 202 555 0147');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => expect(axiosClient.post).toHaveBeenCalled());
    expect(global.mockNavigate).toHaveBeenCalledWith('/texts/thread-7');
  });

  test('phone thread failure falls back to results instead of guessing', async () => {
    render(<GlobalPeopleSearch />);
    axiosClient.post.mockRejectedValueOnce(new Error('network down'));

    typeInSearch('+1 202 555 0147');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(global.mockNavigate).toHaveBeenCalledWith(
        `/people?q=${encodeURIComponent('+1 202 555 0147')}`
      );
    });
  });

  test('pressing Enter triggers explicit results navigation', () => {
    render(<GlobalPeopleSearch />);
    const input = typeInSearch('alice');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    expect(global.mockNavigate).toHaveBeenCalledWith('/people?q=alice');
  });
});
