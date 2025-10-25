import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SaveContactButton from '@/components/SaveContactButton';

// ---------- Mocks ----------

// Mantine primitives
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>{children}</button>
  );
  const TextInput = ({ value, onChange, placeholder }) => (
    <input aria-label={placeholder || 'alias'} value={value} onChange={onChange} />
  );
  const Group = ({ children }) => <div>{children}</div>;
  const Text = ({ children, ...p }) => <span {...p}>{children}</span>;
  return { Button, TextInput, Group, Text };
});

// Icon not relevant to behavior
jest.mock('@tabler/icons-react', () => ({
  IconCheck: (props) => <span data-testid="icon-check" {...props} />,
}));

// axios client (use names starting with "mock" so Jest allows capture)
const mockGet = jest.fn();
const mockPost = jest.fn();

// Mock by alias path
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

// Also mock the relative path the component uses: ../api/axiosClient -> src/api/axiosClient
jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

// Silence error logs (but let us assert calls)
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  jest.clearAllMocks();
});

const props = { currentUserId: 'me-1', otherUserId: 'u-2' };

describe('SaveContactButton', () => {
  test('already saved: shows "Saved" state from initial GET', async () => {
    mockGet.mockResolvedValueOnce({
      data: [{ userId: 'u-2', alias: 'Ally' }, { userId: 'u-9', alias: 'Other' }],
    });

    render(<SaveContactButton {...props} />);

    // After initial fetch resolves, "Saved" appears
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    expect(screen.getByTestId('icon-check')).toBeInTheDocument();

    // No "Save Contact" button anymore
    expect(screen.queryByRole('button', { name: /save contact/i })).not.toBeInTheDocument();
  });

  test('not saved: shows "Save Contact", then input + save; success posts and flips to "Saved"', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ userId: 'someone-else' }] });
    mockPost.mockResolvedValueOnce({ data: { ok: true } });

    render(<SaveContactButton {...props} />);

    // Default path -> "Save Contact" button visible
    expect(await screen.findByRole('button', { name: /save contact/i })).toBeInTheDocument();

    // Click reveals alias input + "Save" button
    fireEvent.click(screen.getByRole('button', { name: /save contact/i }));
    const aliasInput = screen.getByLabelText(/alias/i);
    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    expect(aliasInput).toBeInTheDocument();
    expect(saveBtn).toBeInTheDocument();

    // Type alias and save
    fireEvent.change(aliasInput, { target: { value: ' Pal ' } });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/contacts', {
        ownerId: 'me-1',
        userId: 'u-2',
        alias: ' Pal ', // component sends current alias value as-is (no trimming)
      });
    });

    // Flips to Saved
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  test('POST failure keeps input visible and logs error', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    mockPost.mockRejectedValueOnce(new Error('save failed'));

    render(<SaveContactButton {...props} />);

    // Open input
    fireEvent.click(await screen.findByRole('button', { name: /save contact/i }));
    const aliasInput = screen.getByLabelText(/alias/i);
    fireEvent.change(aliasInput, { target: { value: 'X' } });

    // Attempt save -> fails
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to save contact:',
        expect.any(Error)
      );
    });

    // Should still show input (not flipped to Saved)
    expect(screen.getByLabelText(/alias/i)).toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  test('GET failure logs error and defaults to unsaved UI', async () => {
    mockGet.mockRejectedValueOnce(new Error('fetch failed'));

    render(<SaveContactButton {...props} />);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to check contact:',
        expect.any(Error)
      );
    });

    // Still shows "Save Contact" path
    expect(screen.getByRole('button', { name: /save contact/i })).toBeInTheDocument();
  });

  test('can save with empty alias (optional field)', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    mockPost.mockResolvedValueOnce({ data: { ok: true } });

    render(<SaveContactButton {...props} />);

    fireEvent.click(await screen.findByRole('button', { name: /save contact/i }));
    // leave alias empty and click Save
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/contacts', {
        ownerId: 'me-1',
        userId: 'u-2',
        alias: '',
      });
    });

    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });
});
