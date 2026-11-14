import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';

import BottomComposer from '../BottomComposer.jsx';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key, fallback) => fallback }) }));
jest.mock('lucide-react', () => {
  const Icon = () => <span />;
  return { Smile: Icon, Image: Icon, Send: Icon, Clock3: Icon };
});
jest.mock('@/components/StickerPicker.jsx', () => () => null);
jest.mock('@/components/MicButton.jsx', () => () => null);
jest.mock('@/components/FileUploader.jsx', () => function MockFileUploader({ button, onUploaded }) { return (
  <div>
    {button}
    <button type="button" onClick={() => onUploaded({ key: 'uploads/new.png', contentType: 'image/png', name: 'new.png' })}>
      Attach test image
    </button>
  </div>
); });
jest.mock('@mantine/core', () => {
  const Menu = ({ children }) => <div>{children}</div>;
  Menu.Target = function MockMenuTarget({ children }) { return <div>{children}</div>; };
  Menu.Dropdown = function MockMenuDropdown({ children }) { return <div>{children}</div>; };
  Menu.Label = function MockMenuLabel({ children }) { return <div>{children}</div>; };
  return {
    Card: ({ children }) => <div>{children}</div>,
    Group: ({ children }) => <div>{children}</div>,
    Button: ({ children, onClick, disabled }) => <button type="button" onClick={onClick} disabled={disabled}>{children}</button>,
    ActionIcon: ({ children, onClick, disabled, 'aria-label': label, title }) => <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={title}>{children}</button>,
    Textarea: ({ value, onChange, onKeyDown, 'aria-label': label, disabled }) => <textarea value={value} onChange={onChange} onKeyDown={onKeyDown} aria-label={label} disabled={disabled} />,
    Tooltip: ({ children }) => <>{children}</>,
    Menu,
    Divider: () => <hr />,
    Select: ({ data, value, onChange, 'aria-label': label, disabled }) => <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{data.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
  };
});

function Harness({ onSend, initialText = 'hello', ...props }) {
  const [value, setValue] = useState(initialText);
  return <BottomComposer value={value} onChange={setValue} onSend={onSend} showGif={false} showEmoji={false} showMic={false} {...props} />;
}

describe('chat message timer in BottomComposer', () => {
  test('sends selected TTL and an explicit zero for Off, using the existing plan options', async () => {
    const onSend = jest.fn().mockResolvedValue(undefined);
    render(<Harness onSend={onSend} showMessageTimer expireMaxDays={1} />);

    const timer = screen.getByRole('combobox', { name: 'Message timer' });
    expect(screen.getByRole('button', { name: 'Auto-delete timer' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '30d' })).not.toBeInTheDocument();
    fireEvent.change(timer, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello', expireSeconds: 10 })));

    fireEvent.change(screen.getByRole('textbox', { name: 'Message composer' }), { target: { value: 'again' } });
    fireEvent.change(timer, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'again', expireSeconds: 0 })));
  });

  test('uses the same timer for an attachment and offers the entitled 30-day choice', async () => {
    const onSend = jest.fn().mockResolvedValue(undefined);
    render(<Harness onSend={onSend} initialText="" showMessageTimer expireMaxDays={30} defaultExpireSeconds={60} showUpload />);
    const timer = screen.getByRole('combobox', { name: 'Message timer' });
    expect(timer).toHaveValue('60');
    expect(screen.getByRole('option', { name: '30d' })).toBeInTheDocument();
    fireEvent.change(timer, { target: { value: '2592000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach test image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: '', expireSeconds: 2592000, attachments: [expect.objectContaining({ key: 'uploads/new.png' })] })));
  });

  test('does not expose or send a chat expiry timer for SMS callers', async () => {
    const onSend = jest.fn().mockResolvedValue(undefined);
    render(<Harness onSend={onSend} />);
    expect(screen.queryByRole('combobox', { name: 'Message timer' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).not.toHaveProperty('expireSeconds');
  });
});
