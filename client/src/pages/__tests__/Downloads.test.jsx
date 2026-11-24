import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QRCode from 'qrcode';

import Downloads from '../Downloads.jsx';

jest.mock('@mantine/core', () => {
  const React = require('react');
  const Box = ({ children }) => <div>{children}</div>;

  return {
    Container: Box,
    Paper: Box,
    Title: ({ children }) => <h1>{children}</h1>,
    Text: ({ children }) => <p>{children}</p>,
    Group: ({ children, wrap, style }) => <div data-wrap={wrap} style={style}>{children}</div>,
    Anchor: ({ children, ...props }) => <a {...props}>{children}</a>,
  };
});

const publicAsset = (name) => join(__dirname, '../../../public', name);

test('keeps both store destinations and badge images accessible at matching heights', async () => {
  render(<Downloads />);

  const ios = screen.getByRole('link', { name: 'Download on the App Store' });
  const android = screen.getByRole('link', { name: 'Get it on Google Play' });
  const iosBadge = screen.getByRole('img', { name: 'Download on the App Store' });
  const androidBadge = screen.getByRole('img', { name: 'Get it on Google Play' });

  expect(ios).toHaveAttribute('href', 'https://go.chatforia.com/ios');
  expect(android).toHaveAttribute('href', 'https://go.chatforia.com/android');
  expect(iosBadge).toHaveAttribute('src', '/badges/AppStore.svg');
  expect(androidBadge).toHaveAttribute('src', '/badges/GooglePlay.svg');
  // Google Play's official SVG includes vertical transparent space around its artwork.
  expect(iosBadge).toHaveStyle({ height: '38px', width: 'auto', display: 'block' });
  expect(androidBadge).toHaveStyle({ height: '57px', width: 'auto', display: 'block' });
  expect(iosBadge).toHaveStyle({ maxWidth: '100%' });
  expect(androidBadge).toHaveStyle({ maxWidth: '100%' });
  expect(iosBadge.parentElement.parentElement).toHaveAttribute('data-wrap', 'wrap');

  await userEvent.tab();
  await userEvent.tab();
  expect(ios).toHaveFocus();
  await userEvent.tab();
  expect(android).toHaveFocus();
});

test('shows a working QR asset for the existing smart download link', async () => {
  render(<Downloads />);

  const qrLink = screen.getByRole('link', { name: 'Open the Chatforia download link' });
  const qrImage = screen.getByRole('img', { name: 'Scan to get Chatforia' });
  const qrBytes = readFileSync(publicAsset('qr-chatforia.png'));
  const expectedQrBytes = await QRCode.toBuffer('https://go.chatforia.com/app', {
    width: 512,
    margin: 1,
  });

  expect(qrLink).toHaveAttribute('href', 'https://go.chatforia.com/app');
  expect(qrImage).toHaveAttribute('src', '/qr-chatforia.png');
  expect(qrImage).toHaveAttribute('width', '120');
  expect(qrImage).toHaveAttribute('height', '120');
  expect(qrBytes.equals(expectedQrBytes)).toBe(true);

  await userEvent.tab();
  expect(qrLink).toHaveFocus();
});
