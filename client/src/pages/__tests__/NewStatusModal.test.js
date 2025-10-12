import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---------- Mocks ----------

// axios client
const getMock = jest.fn();
const postMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => getMock(...a),
    post: (...a) => postMock(...a),
  },
}));

// mantine notifications
const notifyShow = jest.fn();
jest.mock('@mantine/notifications', () => ({
  __esModule: true,
  notifications: { show: (...a) => notifyShow(...a) },
}));

// Mantine-core lightweight stubs
jest.mock('@mantine/core', () => {
  const React = require('react');

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

  const Button = ({ children, onClick, disabled, 'aria-label': ariaLabel, type, loading }) => (
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

  const Textarea = ({ label, value, onChange, onKeyDown, placeholder, 'aria-label': ariaLabel }) => (
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

  const TextInput = ({ label, value, onChange, placeholder, 'aria-label': ariaLabel }) => (
    <label>
      {label}
      <input
        aria-label={ariaLabel || label}
        value={value || ''}
        placeholder={placeholder}
        onChange={onChange}
      />
    </label>
  );

  const NumberInput = ({ label, value, onChange, min, max }) => (
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
      />
    </label>
  );

  // Select renders each option as a button for easy clicks
  const Select = ({ label, value, onChange, data }) => (
    <div data-testid={`select-${label}`} data-value={value}>
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

  // MultiSelect toggles by clicking buttons
  const MultiSelect = ({ label, data, value, onChange }) => (
    <div data-testid={`multiselect-${label}`}>
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
              if (cur.has(opt.value)) cur.delete(opt.value);
              else cur.add(opt.value);
              onChange?.(Array.from(cur));
            }}
          >
            {opt.label}{active ? ' ✓' : ''}
          </button>
        );
      })}
    </div>
  );

  // FileInput: expose buttons to add/clear files; component under test calls onChange(value)
  const FileInput = ({ label, value, onChange }) => (
    <div data-testid="fileinput">
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
      <button type="button" data-testid="clear-files" onClick={() => onChange?.([])}>
        clear files
      </button>
    </div>
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
  };
});

// SUT
import NewStatusModal from './NewStatusModal';

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
    getMock.mockReset();
    postMock.mockReset();
    notifyShow.mockReset();
  });

  const renderModal = (props = {}) =>
    render(<NewStatusModal opened={true} onClose={props.onClose || jest.fn()} />);

  test('Post disabled when caption/files empty; enabled when caption present', () => {
    renderModal();

    const postBtn = screen.getByRole('button', { name: /post/i });
    expect(postBtn).toBeDisabled();

    // Type a caption
    fireEvent.change(screen.getByLabelText(/Status message/i), { target: { value: 'hi there' } });
    expect(postBtn).not.toBeDisabled();

    // Clear caption -> still disabled until we add files
    fireEvent.change(screen.getByLabelText(/Status message/i), { target: { value: '   ' } });
    expect(postBtn).toBeDisabled();

    // Add a file -> enabled
    fireEvent.click(screen.getByTestId('add-file'));
    expect(postBtn).not.toBeDisabled();
  });

  test('successful post builds proper FormData and resets state', async () => {
    postMock.mockResolvedValueOnce({ data: { ok: true } });
    const onClose = jest.fn();
    render(<NewStatusModal opened={true} onClose={onClose} />);

    // defaults: audience MUTUALS, expire 24h
    // caption + one file
    fireEvent.change(screen.getByLabelText(/Status message/i), { target: { value: 'My status' } });
    fireEvent.click(screen.getByTestId('add-file'));

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /post status/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());

    // inspect FormData
    const [, fd] = postMock.mock.calls[0];
    const obj = formDataToObject(fd);
    expect(obj.caption).toBe('My status');
    expect(obj.audience).toBe('MUTUALS');
    expect(obj.expireSeconds).toBe(String(24 * 3600));
    expect(Array.isArray(obj.files)).toBe(true);
    expect(obj.files[0]).toBeInstanceOf(File);
    expect(obj.customAudienceIds).toBeUndefined();

    // success notification + onClose + resets
    expect(notifyShow).toHaveBeenCalledWith(expect.objectContaining({ message: 'Status posted' }));
    expect(onClose).toHaveBeenCalled();

    // Fields reset
    expect(screen.getByLabelText(/Status message/i)).toHaveValue('');
    expect(screen.getByTestId('file-count')).toHaveTextContent('0');
    // audience select reset to MUTUALS
    expect(screen.getByTestId('select-Audience')).toHaveAttribute('data-value', 'MUTUALS');
  });

  test('audience CUSTOM loads contacts and includes selected IDs in payload', async () => {
    // server returns two shapes (the code supports items[] or plain array)
    getMock.mockResolvedValueOnce({
      data: { items: [{ user: { id: 11, username: 'alpha' } }, { contactUserId: 22 }] },
    });

    postMock.mockResolvedValueOnce({ data: { ok: true } });

    renderModal();

    // Choose "Custom..." audience
    fireEvent.click(screen.getByTestId('opt-Audience-CUSTOM'));

    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/contacts'));

    // Pick both contacts
    fireEvent.click(screen.getByTestId('multiopt-11'));
    fireEvent.click(screen.getByTestId('multiopt-22'));

    // Provide minimal content: caption
    fireEvent.change(screen.getByLabelText(/Status message/i), { target: { value: 'hello' } });

    fireEvent.click(screen.getByRole('button', { name: /post status/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalled());

    const [, fd] = postMock.mock.calls[0];
    const obj = formDataToObject(fd);

    // Should be stringified numbers
    expect(obj.customAudienceIds).toBe(JSON.stringify([11, 22]));
    expect(obj.audience).toBe('CUSTOM');
  });

  test('can change expiry seconds and value is sent', async () => {
    postMock.mockResolvedValueOnce({ data: {} });
    renderModal();

    // change expiry to 3600
    fireEvent.change(screen.getByRole('spinbutton', { name: /Expires \(seconds\)/i }), { target: { value: '3600' } });

    // add caption so we can submit
    fireEvent.change(screen.getByLabelText(/Status message/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /post status/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const [, fd] = postMock.mock.calls[0];
    const obj = formDataToObject(fd);
    expect(obj.expireSeconds).toBe('3600');
  });

  test('failure path shows error notification and keeps modal open', async () => {
    postMock.mockRejectedValueOnce(new Error('nope'));
    const onClose = jest.fn();
    render(<NewStatusModal opened={true} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/Status message/i), { target: { value: 'fail me' } });
    fireEvent.click(screen.getByRole('button', { name: /post status/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(notifyShow).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to post status', color: 'red' })
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  test('Cancel button and Escape key call onClose', () => {
    const onClose = jest.fn();
    render(<NewStatusModal opened={true} onClose={onClose} />);

    // Escape in textarea
    fireEvent.keyDown(screen.getByLabelText(/Status message/i), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Click Cancel
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
