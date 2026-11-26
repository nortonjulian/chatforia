import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SmsCompose from '../SmsCompose.jsx';

const mockNavigate = jest.fn();
const mockGet = jest.fn();
const mockPost = jest.fn();
let mockAttachments = [];
let mockSearchParams = new URLSearchParams('to=%2B15555550123');

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParams],
}));
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args), post: (...args) => mockPost(...args) },
}));
jest.mock('@mantine/core', () => ({
  Box: ({ children }) => <div>{children}</div>,
  Group: ({ children }) => <div>{children}</div>,
  Text: ({ children, role }) => <span role={role}>{children}</span>,
  Button: ({ children, onClick }) => <button onClick={onClick}>{children}</button>,
}));
jest.mock('@tabler/icons-react', () => ({ IconX: () => null }));
jest.mock('@/components/BottomComposer.jsx', () => ({
  __esModule: true,
  default: ({ value, onChange, onSend, onPickMedia, showMic, prepareFile }) => (
    <div data-testid="composer" data-mic={String(showMic)} data-preparer={String(typeof prepareFile)}>
      <input aria-label="Message composer" value={value} onChange={(event) => onChange(event.target.value)} />
      <button onClick={async () => {
        const result = await onSend({ text: value, attachments: mockAttachments });
        if (result !== false) onChange('');
      }}>Send message</button>
      <button onClick={() => onPickMedia({ kind: 'GIF', url: 'https://media.example/gif' })}>Pick GIF</button>
    </div>
  ),
}));
jest.mock('@/components/RecipientSelector', () => ({
  __esModule: true,
  default: ({ value }) => <div data-testid="recipient">{value[0]?.phone || ''}</div>,
}));
jest.mock('@/components/profile/PhoneNumberManager', () => ({ NumberPickerModal: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key, fallback) => fallback }) }));
jest.mock('@/utils/analytics', () => ({ __esModule: true, default: { capture: jest.fn() } }));

beforeEach(() => {
  mockNavigate.mockReset();
  mockGet.mockReset();
  mockPost.mockReset();
  mockAttachments = [];
  mockSearchParams = new URLSearchParams('to=%2B15555550123');
  mockGet.mockImplementation((url) => Promise.resolve({
    data: url === '/numbers/my' ? { number: '+15555550000' } : {},
  }));
});

test('uses the existing SMS contract for a text-only first message', async () => {
  mockPost.mockResolvedValue({ data: { threadId: 41 } });
  render(<SmsCompose />);
  expect(screen.getByTestId('composer')).toHaveAttribute('data-mic', 'false');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message composer' }), { target: { value: ' Hello ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/sms/send', { to: '+15555550123', body: 'Hello' }));
  expect(mockNavigate).toHaveBeenCalledWith('/sms/41');
});

test('sends a captioned first MMS using the private upload reference', async () => {
  mockAttachments = [{ key: 'uploads/u66/photo.jpg', mimeType: 'image/jpeg', size: 42000 }];
  mockPost.mockResolvedValue({ data: { threadId: 42 } });
  render(<SmsCompose />);
  expect(screen.getByTestId('composer')).toHaveAttribute('data-preparer', 'function');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message composer' }), { target: { value: 'Caption' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/sms/send', {
    to: '+15555550123', body: 'Caption', mediaUrls: ['uploads/u66/photo.jpg'],
  }));
  expect(mockNavigate).toHaveBeenCalledWith('/sms/42');
});

test('allows image-only MMS and preserves the draft after an offline failure', async () => {
  mockAttachments = [{ key: 'uploads/u66/photo.jpg', mimeType: 'image/jpeg', size: 42000 }];
  mockPost.mockRejectedValueOnce(new Error('Offline'));
  render(<SmsCompose />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Message composer' }), { target: { value: 'Keep this caption' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Offline'));
  expect(screen.getByRole('textbox', { name: 'Message composer' })).toHaveValue('Keep this caption');
  expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringMatching(/^\/sms\/\d+$/));

  fireEvent.change(screen.getByRole('textbox', { name: 'Message composer' }), { target: { value: '' } });
  mockPost.mockResolvedValueOnce({ data: { threadId: 43 } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(mockPost).toHaveBeenLastCalledWith('/sms/send', {
    to: '+15555550123', body: '', mediaUrls: ['uploads/u66/photo.jpg'],
  }));
});

test('keeps GIF selection as an SMS link instead of an unauthorized media reference', () => {
  render(<SmsCompose />);
  fireEvent.click(screen.getByRole('button', { name: 'Pick GIF' }));
  expect(screen.getByRole('textbox', { name: 'Message composer' })).toHaveValue('https://media.example/gif');
});

test('rejects a non-phone recipient before any carrier request', async () => {
  mockSearchParams = new URLSearchParams('to=person%40example.com');
  render(<SmsCompose />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Message composer' }), { target: { value: 'Do not send' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Add a recipient'));
  expect(mockPost).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Message composer' })).toHaveValue('Do not send');
});
