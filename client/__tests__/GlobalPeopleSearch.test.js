import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GlobalPeopleSearch from '@/components/GlobalPeopleSearch'; // <-- update if needed

// ---------------- Mocks ----------------

// Mantine components: simple primitives
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
  return { TextInput, Button };
});

// Icon not relevant to behavior
jest.mock('@tabler/icons-react', () => ({
  IconSearch: (props) => <span data-testid="icon-search" {...props} />,
}));

// Router navigate
const navigateMock = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

// axios client
const getMock = jest.fn();
const postMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => getMock(...args),
    post: (...args) => postMock(...args),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

function typeInSearch(value) {
  const input = screen.getByLabelText(/global people search/i);
  fireEvent.change(input, { target: { value } });
  return input;
}

describe('GlobalPeopleSearch', () => {
  test('respects layout props: default align left, custom align center and maxWidth', () => {
    const { container, rerender } = render(<GlobalPeopleSearch />);
    // Outer container is first div, inner row is second div
    const outer = container.querySelector('div');
    const inner = outer.querySelector('div');

    // Default align = left
    expect(outer.style.justifyContent).toBe('flex-start');
    // Default maxWidth = 640
    expect(inner.style.maxWidth).toBe('640px');

    rerender(<GlobalPeopleSearch align="center" maxWidth={720} />);
    const outer2 = container.querySelector('div');
    const inner2 = outer2.querySelector('div');
    expect(outer2.style.justifyContent).toBe('center');
    expect(inner2.style.maxWidth).toBe('720px');
  });

  test('does nothing on empty or whitespace-only query', async () => {
    render(<GlobalPeopleSearch />);

    // Click search with empty input
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(getMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();

    // Whitespace only
    typeInSearch('   ');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(getMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('successful flow: finds user (array form) -> creates room -> navigates to /chat/:id', async () => {
    render(<GlobalPeopleSearch />);

    getMock.mockResolvedValueOnce({ data: [{ id: 'u123' }] });
    postMock.mockResolvedValueOnce({ data: { id: 'r999' } });

    typeInSearch('  alice  '); // ensure trimming
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/search/users', { params: { q: 'alice' } });
    });
    expect(postMock).toHaveBeenCalledWith('/chatrooms/direct/u123');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/chat/r999');
    });
  });

  test('successful flow: finds user (object form) -> room missing id => navigates to /people?q=', async () => {
    render(<GlobalPeopleSearch />);

    getMock.mockResolvedValueOnce({ data: { user: { id: 'u55' } } });
    postMock.mockResolvedValueOnce({ data: {} });

    typeInSearch('bob');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(getMock).toHaveBeenCalled();
    });
    expect(postMock).toHaveBeenCalledWith('/chatrooms/direct/u55');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/people?q=bob');
    });
  });

  test('no user found -> navigates to /people?q=', async () => {
    render(<GlobalPeopleSearch />);

    getMock.mockResolvedValueOnce({ data: [] }); // array but empty

    typeInSearch('charlie');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(getMock).toHaveBeenCalled();
    });
    expect(postMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/people?q=charlie');
  });

  test('any error falls back to /people?q=', async () => {
    render(<GlobalPeopleSearch />);

    getMock.mockRejectedValueOnce(new Error('network down'));

    typeInSearch('daisy');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/people?q=daisy');
    });
  });

  test('pressing Enter in the input triggers submit', async () => {
    render(<GlobalPeopleSearch />);

    getMock.mockResolvedValueOnce({ data: [] });

    const input = typeInSearch('eve');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/search/users', { params: { q: 'eve' } });
    });
    expect(navigateMock).toHaveBeenCalledWith('/people?q=eve');
  });
});
