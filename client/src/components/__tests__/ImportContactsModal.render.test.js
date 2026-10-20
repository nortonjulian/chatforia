import React from 'react';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import ImportContactsModal from '../ImportContactsModal';

jest.mock('@/api/contacts', () => ({ importContacts: jest.fn() }));
jest.mock('@/utils/toast', () => ({ toast: { ok: jest.fn() } }));

test('actual Mantine modal renders labeled file controls and an unavailable empty import', () => {
  window.matchMedia = window.matchMedia || (() => ({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return false;}}));
  render(<MantineProvider><ImportContactsModal opened onClose={jest.fn()} /></MantineProvider>);
  expect(screen.getByRole('dialog', {name:'Import contacts'})).toBeInTheDocument();
  expect(screen.getByLabelText('CSV file')).toBeInTheDocument();
  expect(screen.getByLabelText('VCF file')).toBeInTheDocument();
  expect(screen.getByRole('button', {name:'Import selected'})).toBeDisabled();
});
