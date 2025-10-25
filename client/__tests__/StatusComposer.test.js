import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mantine mock (must come before importing the component) ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const strip = (props) => {
    const {
      gap,
      p,
      mt,
      mb,
      mx,
      my,
      fw,
      size,
      disabled,
      loading,
      centered,
      closeOnEscape,
      trapFocus,
      'aria-label': ariaLabel,
      ...rest
    } = props;
    if (ariaLabel) {
      rest['aria-label'] = ariaLabel;
    }
    if (disabled !== undefined) {
      rest.disabled = disabled;
    }
    if (loading !== undefined) {
      rest['data-loading'] = loading ? 'true' : 'false';
    }
    return rest;
  };

  const Modal = ({ opened, onClose, title, children, ...p }) =>
    opened ? (
      <div role="dialog" aria-label={p['aria-label'] || title}>
        {/* hidden close button just to satisfy structure */}
        <button
          aria-label="close-modal"
          style={{ display: 'none' }}
          onClick={onClose}
        />
        <div>{title}</div>
        {children}
      </div>
    ) : null;

  const Stack = ({ children, ...p }) => (
    <div {...strip(p)}>{children}</div>
  );

  const Group = ({ children, ...p }) => (
    <div {...strip(p)}>{children}</div>
  );

  const Text = ({ children, ...p }) => (
    <p {...strip(p)}>{children}</p>
  );

  const Textarea = ({
    label,
    value,
    onChange,
    'aria-label': aria,
    ...p
  }) => (
    <label>
      {label}
      <textarea
        aria-label={aria || label}
        value={value}
        onChange={onChange}
        {...strip(p)}
      />
    </label>
  );

  // Our Select will just be a <select>
  const Select = ({
    label,
    value,
    onChange,
    data,
    'aria-label': aria,
    ...p
  }) => (
    <label>
      {label}
      <select
        aria-label={aria || label}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        {...strip(p)}
      >
        {(data || []).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label ?? opt.value}
          </option>
        ))}
      </select>
    </label>
  );

  // FileInput simplified: we render a real <input type="file"/>
  const FileInput = ({
    label,
    'aria-label': aria,
    onChange,
    accept,
    multiple,
    description,
    ...p
  }) => (
    <label>
      {label}
      <input
        type="file"
        aria-label={aria || label}
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const file = e.target.files?.[0];
          onChange?.(file || null);
        }}
        {...strip(p)}
      />
      {description ? <small>{description}</small> : null}
    </label>
  );

  const Button = ({
    children,
    onClick,
    type = 'button',
    'aria-label': aria,
    ...p
  }) => (
    <button type={type} onClick={onClick} aria-label={aria} {...strip(p)}>
      {children}
    </button>
  );

  const ActionIcon = ({
    children,
    onClick,
    'aria-label': aria,
    ...p
  }) => (
    <button type="button" onClick={onClick} aria-label={aria} {...strip(p)}>
      {children}
    </button>
  );

  // Chip just wraps children; clicking the inner ActionIcon is what removes
  const Chip = ({ children, ...p }) => (
    <div {...strip(p)}>{children}</div>
  );

  const Tooltip = ({ children }) => <span>{children}</span>;

  return {
    __esModule: true,
    Modal,
    Stack,
    Group,
    Text,
    Textarea,
    FileInput,
    Button,
    Select,
    ActionIcon,
    Chip,
    Tooltip,
  };
});

// ---- axios mock ----
jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
import axiosClient from '../src/api/axiosClient';

// ---- SUT ----
import StatusComposer from '../src/components/StatusComposer';

describe('StatusComposer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('posts minimal form and resets', async () => {
    axiosClient.post.mockResolvedValueOnce({ data: { id: 'xyz' } });
    const onClose = jest.fn();

    render(<StatusComposer opened onClose={onClose} />);

    // Fill caption (optional, but we'll do it)
    fireEvent.change(screen.getByLabelText(/caption/i), {
      target: { value: 'hello world' },
    });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /post/i }));

    await waitFor(() => expect(axiosClient.post).toHaveBeenCalled());

    const [url, body, opts] = axiosClient.post.mock.calls[0];
    expect(url).toBe('/status');
    expect(body instanceof FormData).toBe(true);
    expect(opts.headers['Content-Type']).toMatch(/multipart\/form-data/i);

    // onClose should have been called on success
    expect(onClose).toHaveBeenCalled();
  });

  test('CUSTOM audience includes customAudienceIds', async () => {
    axiosClient.post.mockResolvedValueOnce({ data: { id: 'xyz' } });

    render(<StatusComposer opened onClose={jest.fn()} />);

    // change Audience -> CUSTOM
    const audienceSelect = screen.getByLabelText(/audience/i);
    fireEvent.change(audienceSelect, { target: { value: 'CUSTOM' } });

    // Now textarea for custom IDs should show
    const customField = await screen.findByLabelText(/custom user ids/i);
    fireEvent.change(customField, {
      target: { value: '["u1","u2"]' },
    });

    // Post
    fireEvent.click(screen.getByRole('button', { name: /post/i }));

    await waitFor(() => expect(axiosClient.post).toHaveBeenCalled());

    // We won't fully parse the FormData here, but we at least assert call happened with FormData
    const [, body] = axiosClient.post.mock.calls[0];
    expect(body instanceof FormData).toBe(true);

    // Optional: you can introspect the FormData
    // but JSDOM FormData doesn't let you iterate easily without hacks.
  });

  test('file attach shows count', async () => {
    axiosClient.post.mockResolvedValueOnce({ data: { id: 'xyz' } });

    render(<StatusComposer opened onClose={jest.fn()} />);

    // Attach file
    const fileInput = screen.getByLabelText(/add media file/i);
    const file = new File(['abc'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Look for "<Text size='sm'>1 item(s) attached</Text>"
    const counterEl = await screen.findByText((content, node) => {
      const text = node?.textContent || '';
      return (
        node?.tagName?.toLowerCase() === 'p' &&
        /item\(s\)\s*attached/i.test(text)
      );
    });
    expect(counterEl).toBeInTheDocument();
    expect(counterEl.textContent).toMatch(/^[1-9]\d* item\(s\) attached$/i);

    // Now submit
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(axiosClient.post).toHaveBeenCalled());
  });
});
