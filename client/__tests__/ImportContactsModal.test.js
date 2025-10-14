import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/* --- Mocks (use the ALIAS paths consistently) --- */
jest.mock('@/api/contacts', () => ({ importContacts: jest.fn() }), { virtual: true });

jest.mock('@/utils/toast', () => ({ toast: { ok: jest.fn(), err: jest.fn(), info: jest.fn() } }), { virtual: true });
jest.mock('@/utils/safeToast', () => ({ toast: { ok: jest.fn(), err: jest.fn(), info: jest.fn() } }), { virtual: true });

/* --- Import the component via the alias --- */
import ImportContactsModal from '@/components/ImportContactsModal.jsx';

/* --- Helpers --- */
function fileFromString(name, content, type = 'text/plain') {
  return new File([content], name, { type });
}

test('parses CSV and submits selected', async () => {
  // Configure the mock AFTER the factory has been registered
  const api = require('@/api/contacts');
  api.importContacts.mockResolvedValue({
    ok: true, added: 2, updated: 0, skippedDuplicates: 0, invalid: 0,
  });

  const { container } = render(
    <ImportContactsModal opened onClose={() => {}} defaultCountry="US" />
  );

  // Select CSV file (grab the first native <input type="file">)
  const inputs = container.querySelectorAll('input[type="file"]');
  expect(inputs.length).toBeGreaterThan(0);
  const csvInput = inputs[0];

  const csv =
    'Name,Phone,Email\nAlice,+1 555 1111,alice@example.com\nBob,+1 555 2222,bob@example.com\n';
  const csvFile = fileFromString('contacts.csv', csv, 'text/csv');

  Object.defineProperty(csvInput, 'files', { value: [csvFile] });
  fireEvent.change(csvInput);

  // Wait for parsed rows to render
  await screen.findByText('Alice');
  await screen.findByText('Bob');

  // Click Import
  const submitBtn = screen.getByRole('button', { name: /import selected/i });
  fireEvent.click(submitBtn);

  await waitFor(() => expect(api.importContacts).toHaveBeenCalled());
});
