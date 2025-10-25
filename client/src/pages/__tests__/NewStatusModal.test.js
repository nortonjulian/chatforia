import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---------- Mocks ----------

// axios client
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    post: (...a) => mockPost(...a),
  },
}));

// mantine notifications
const mockNotifyShow = jest.fn();
jest.mock('@mantine/notifications', () => ({
  __esModule: true,
  notifications: { show: (...a) => mockNotifyShow(...a) },
}));

// Mantine-core lightweight stubs
jest.mock('@mantine/core', () => {
  const React = require('react');

  // simple passthrough container that preserves children + exposes testid
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );

  const Modal = ({ opened, children, title, ...rest }) =>
    opened ? (
      <div data-testid="modal" {...rest}>
        <div>{title}</div>
        {children}
      </div>
    ) : null;

  const Button = ({
    children,
    onClick,
    disabled,
    loading,
    type,
    'aria-label': ariaLabel,
  }) => (
    <button
      type={type || 'button'}
      aria-label={ariaLabel}
      disabled={!!disabled || !!loading}
      onClick={onClick}
    >
      {children}
    </button>
  );

  const Text = ({ children, ...rest }) => <div {...rest}>{children}</div>;

  const Textarea = ({
    label,
    value,
    onChange,
    onKeyDown,
    placeholder,
    'aria-label': ariaLabel,
  }) => (
    <label>
      {label}
      <textarea
        aria-label={ariaLabel || label}
        placeholder={placeholder}
        value={value || ''}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    </label>
  );

  const NumberInput = ({
    label,
    value,
    onChange,
    min,
    max,
    ...rest
  }) => (
    <label>
      {label}
      <input
        role="spinbutton"
        aria-label={label}
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => onChange?.(Number(e.target.value))}
        {...rest}
      />
    </label>
  );

  // Select renders each option as a clickable button so tests can drive onChange
  const Select = ({ label, value, onChange, data, ...rest }) => (
    <div data-testid={`select-${label}`} data-value={value} {...rest}>
      {(data || []).map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-testid={`opt-${label}-${opt.value}`}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  // MultiSelect toggles presence in array using buttons
  const MultiSelect = ({ label, data, value, onChange, ...rest }) => (
    <div data-testid={`multiselect-${label}`} {...rest}>
      {(data || []).map((opt) => {
        const active = (value || []).includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`multiopt-${opt.value}`}
            aria-pressed={active ? 'true' : 'false'}
            onClick={() => {
              const cur = new Set(value || []);
              if (cur.has(opt.value)) {
                cur.delete(opt.value);
              } else {
                cur.add(opt.value);
              }
              onChange?.(Array.from(cur));
            }}
          >
            {opt.label}{active ? ' ✓' : ''}
          </button>
        );
      })}
    </div>
  );

  // FileInput mock: lets tests "add file" / "clear files", and shows count
  const FileInput = ({ label, value, onChange, ...rest }) => (
    <div data-testid="fileinput" {...rest}>
      <div>{label}</div>
      <div data-testid="file-count">{(value || []).length}</div>
      <button
        type="button"
        data-testid="add-file"
        onClick={() => {
          const f = new File(['hello'], 'pic.png', { type: 'image/png' });
          onChange?.([...(value || []), f]);
        }}
      >
        add file
      </button>
      <button
        type="button"
        data-testid="clear-files"
        onClick={() => onChange?.([])}
      >
        clear files
      </button>
    </div>
  );

  const Tooltip = ({ label, children }) => (
    <div data-testid="tooltip" data-label={label}>
      {children}
    </div>
  );

  const Badge = ({ children, ...rest }) => (
    <span role="status" {...rest}>
      {children}
    </span>
  );

  return {
    __esModule: true,
    Modal,
    Textarea,
    Button,
    Group: passthru('group'),
    Select,
    FileInput,
    Stack: passthru('stack'),
    Text,
    MultiSelect,
    NumberInput,
    Tooltip,
    Badge,
  };
});

// -------- SUT --------
import NewStatusModal from '../NewStatusModal';

// -------- helpers --------
function formDataToObject(fd) {
  const obj = {};
  for (const [k, v] of fd.entries()) {
    if (k === 'files') {
      if (!obj.files) obj.files = [];
      obj.files.push(v);
    } else {
      obj[k] = v;
    }
  }
  return obj;
}

describe('NewStatusModal', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockNotifyShow.mockReset();
  });

  const renderModal = (props = {}) =>
    render(<NewStatusModal opened={true} onClose={props.onClose || jest.fn()} />);

  test('Post disabled when caption/files empty; enabled when caption present', () => {
    renderModal();

    const postBtn = screen.getByRole('button', { name: /post/i });
    expect(postBtn).toBeDisabled();

    // Type a caption
    fireEvent.change(
      screen.getByLabelText(/Status message/i),
      { target: { value: 'hi there' } }
    );
    expect(postBtn).not.toBeDisabled();

    // Clear caption -> disabled again until we add files
    fireEvent.change(
      screen.getByLabelText(/Status message/i),
      { target: { value: '   ' } }
    );
    expect(postBtn).toBeDisabled();

    // Add a file -> enabled
    fireEvent.click(screen.getByTestId('add-file'));
    expect(postBtn).not.toBeDisabled();
  });

  test('successful post builds proper FormData and resets state', async () => {
    mockPost.mockResolvedValueOnce({ data: { ok: true } });
    const onClose = jest.fn();
    render(<NewStatusModal opened={true} onClose={onClose} />);

    // defaults: audience MUTUALS, expireHours = 24
    // caption + one file
    fireEvent.change(
      screen.getByLabelText(/Status message/i),
      { target: { value: 'My status' } }
    );
    fireEvent.click(screen.getByTestId('add-file'));

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /post status/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());

    // inspect FormData
    const [, fd] = mockPost.mock.calls[0];
    const obj = formDataToObject(fd);

    expect(obj.caption).toBe('My status');
    expect(obj.audience).toBe('MUTUALS');

    // expireHours defaults to 24, API wants seconds
    expect(obj.expireSeconds).toBe(String(24 * 3600));

    expect(Array.isArray(obj.files)).toBe(true);
    expect(obj.files[0]).toBeInstanceOf(File);
    expect(obj.customAudienceIds).toBeUndefined();

    // success notification + onClose + reset UI
    expect(mockNotifyShow).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Status posted', withBorder: true })
    );
    expect(onClose).toHaveBeenCalled();

    // Fields reset
    expect(screen.getByLabelText(/Status message/i)).toHaveValue('');
    expect(screen.getByTestId('file-count')).toHaveTextContent('0');

    // audience select reset to MUTUALS
    expect(screen.getByTestId('select-Audience')).toHaveAttribute(
      'data-value',
      'MUTUALS'
    );
  });

  test('audience CUSTOM loads contacts and includes selected IDs in payload', async () => {
    // server returns two shapes (the component supports items[] or plain array)
    mockGet.mockResolvedValueOnce({
      data: {
        items: [
          { user: { id: 11, username: 'alpha' } },
          { contactUserId: 22 },
        ],
      },
    });

    mockPost.mockResolvedValueOnce({ data: { ok: true } });

    renderModal();

    // Choose "Custom..." audience
    fireEvent.click(screen.getByTestId('opt-Audience-CUSTOM'));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/contacts')
    );

    // Pick both contacts
    fireEvent.click(screen.getByTestId('multiopt-11'));
    fireEvent.click(screen.getByTestId('multiopt-22'));

    // Provide minimal content: caption
    fireEvent.change(
      screen.getByLabelText(/Status message/i),
      { target: { value: 'hello' } }
    );

    fireEvent.click(screen.getByRole('button', { name: /post status/i }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());

    const [, fd] = mockPost.mock.calls[0];
    const obj = formDataToObject(fd);

    // customAudienceIds should be JSON string of numeric IDs
    expect(obj.customAudienceIds).toBe(JSON.stringify([11, 22]));
    expect(obj.audience).toBe('CUSTOM');
  });

  test('can change expiry hours and value is sent as seconds', async () => {
    mockPost.mockResolvedValueOnce({ data: {} });
    renderModal();

    // change expiryHours to 1 hour
    fireEvent.change(
      screen.getByRole('spinbutton', { name: /Expires \(hours\)/i }),
      { target: { value: '1' } }
    );

    // add caption so we can submit
    fireEvent.change(
      screen.getByLabelText(/Status message/i),
      { target: { value: 'x' } }
    );

    fireEvent.click(screen.getByRole('button', { name: /post status/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const [, fd] = mockPost.mock.calls[0];
    const obj = formDataToObject(fd);

    // 1 hour -> 3600 seconds
    expect(obj.expireSeconds).toBe('3600');
  });

  test('failure path shows error notification and keeps modal open', async () => {
    mockPost.mockRejectedValueOnce(new Error('nope'));
    const onClose = jest.fn();
    render(<NewStatusModal opened={true} onClose={onClose} />);

    fireEvent.change(
      screen.getByLabelText(/Status message/i),
      { target: { value: 'fail me' } }
    );
    fireEvent.click(screen.getByRole('button', { name: /post status/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());

    expect(mockNotifyShow).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to post status',
        color: 'red',
        withBorder: true,
      })
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  test('Cancel button and Escape key call onClose', () => {
    const onClose = jest.fn();
    render(<NewStatusModal opened={true} onClose={onClose} />);

    // Escape in textarea should close
    fireEvent.keyDown(
      screen.getByLabelText(/Status message/i),
      { key: 'Escape' }
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    // Click Cancel button
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('adding and clearing files affects Post disabled state', () => {
    renderModal();

    const postBtn = screen.getByRole('button', { name: /post/i });
    expect(postBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId('add-file'));
    expect(postBtn).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('clear-files'));
    expect(postBtn).toBeDisabled();
  });
});
