import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GlobalPeopleSearch from '@/components/GlobalPeopleSearch';

// ---------- Mocks ----------

// Mantine -> simple primitives
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

// Icon (not behavior-critical)
jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconSearch: (props) => <span data-testid="icon-search" {...props} />,
}));

// Router: expose a global mock (allowed in factory)
global.mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => global.mockNavigate,
}));

// axios client: define fns inside factory, then use imported mock
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));
import axiosClient from '@/api/axiosClient'; // <-- use these mocks

beforeEach(() => {
  jest.clearAllMocks();
  global.mockNavigate.mockReset();
});

// helpers
function typeInSearch(value) {
  const input = screen.getByLabelText(/global people search/i);
  fireEvent.change(input, { target: { value } });
  return input;
}

describe('GlobalPeopleSearch', () => {
  test('respects layout props: default align left, custom align center and maxWidth', () => {
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
    expect(axiosClient.get).not.toHaveBeenCalled();
    expect(global.mockNavigate).not.toHaveBeenCalled();

    typeInSearch('   ');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(axiosClient.get).not.toHaveBeenCalled();
    expect(global.mockNavigate).not.toHaveBeenCalled();
  });

  test('successful flow: finds user (array) -> creates room -> navigates to /chat/:id', async () => {
    render(<GlobalPeopleSearch />);

    axiosClient.get.mockResolvedValueOnce({ data: [{ id: 'u123' }] });
    axiosClient.post.mockResolvedValueOnce({ data: { id: 'r999' } });

    typeInSearch('  alice  ');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(axiosClient.get).toHaveBeenCalledWith('/search/users', { params: { q: 'alice' } });
    });
    expect(axiosClient.post).toHaveBeenCalledWith('/chatrooms/direct/u123');

    await waitFor(() => {
      expect(global.mockNavigate).toHaveBeenCalledWith('/chat/r999');
    });
  });

  test('successful flow: finds user (object) -> room missing id => navigates to /people?q=', async () => {
    render(<GlobalPeopleSearch />);

    axiosClient.get.mockResolvedValueOnce({ data: { user: { id: 'u55' } } });
    axiosClient.post.mockResolvedValueOnce({ data: {} });

    typeInSearch('bob');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => expect(axiosClient.get).toHaveBeenCalled());
    expect(axiosClient.post).toHaveBeenCalledWith('/chatrooms/direct/u55');

    await waitFor(() => {
      expect(global.mockNavigate).toHaveBeenCalledWith('/people?q=bob');
    });
  });

  test('no user found -> navigates to /people?q=', async () => {
    render(<GlobalPeopleSearch />);

    axiosClient.get.mockResolvedValueOnce({ data: [] });

    typeInSearch('charlie');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => expect(axiosClient.get).toHaveBeenCalled());
    expect(axiosClient.post).not.toHaveBeenCalled();
    expect(global.mockNavigate).toHaveBeenCalledWith('/people?q=charlie');
  });

  test('any error falls back to /people?q=', async () => {
    render(<GlobalPeopleSearch />);

    axiosClient.get.mockRejectedValueOnce(new Error('network down'));

    typeInSearch('daisy');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(global.mockNavigate).toHaveBeenCalledWith('/people?q=daisy');
    });
  });

  test('pressing Enter triggers submit', async () => {
    render(<GlobalPeopleSearch />);

    axiosClient.get.mockResolvedValueOnce({ data: [] });

    const input = typeInSearch('eve');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(axiosClient.get).toHaveBeenCalledWith('/search/users', { params: { q: 'eve' } });
    });
    expect(global.mockNavigate).toHaveBeenCalledWith('/people?q=eve');
  });
});
