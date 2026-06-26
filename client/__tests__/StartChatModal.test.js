import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import StartChatModal from '../src/components/StartChatModal.jsx';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

function renderModal(props = {}) {
  return render(
    <MantineProvider>
      <StartChatModal
        opened
        onClose={jest.fn()}
        onStartDirectMessage={jest.fn()}
        {...props}
      />
    </MantineProvider>
  );
}

test('renders the start chat modal', () => {
  renderModal();

  expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  expect(
    screen.getByPlaceholderText(/search name, username, or phone number/i)
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /message this person/i })
  ).toBeDisabled();
});

test('starts a manual direct message from typed query', async () => {
  const user = userEvent.setup();
  const onStartDirectMessage = jest.fn();

  renderModal({ onStartDirectMessage });

  await user.type(
    screen.getByPlaceholderText(/search name, username, or phone number/i),
    'alice'
  );

  const button = screen.getByRole('button', {
    name: /message this person/i,
  });

  expect(button).toBeEnabled();

  await user.click(button);

  expect(onStartDirectMessage).toHaveBeenCalledWith({
    type: 'manual',
    value: 'alice',
  });
});

test('uses initialDraft when modal opens', () => {
  renderModal({
    initialDraft: {
      value: '+15555555555',
    },
  });

  expect(
    screen.getByPlaceholderText(/search name, username, or phone number/i)
  ).toHaveValue('+15555555555');
});

test('shows recent interactions when query is empty', () => {
  renderModal({
    recentInteractions: [
      {
        id: 1,
        name: 'Alice Smith',
        username: 'alice',
        phone: '+15551111111',
        interactionType: 'message',
      },
    ],
  });

  expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  expect(screen.getByText(/message • \+15551111111 • @alice/i)).toBeInTheDocument();
});

test('filters saved contacts by query', async () => {
  const user = userEvent.setup();

  renderModal({
    savedContacts: [
      {
        id: 1,
        name: 'Alice Smith',
        username: 'alice',
      },
      {
        id: 2,
        name: 'Bob Jones',
        username: 'bob',
      },
    ],
  });

  await user.type(
    screen.getByPlaceholderText(/search name, username, or phone number/i),
    'alice'
  );

  expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
});

test('selecting a contact starts direct message with contact payload', async () => {
  const user = userEvent.setup();
  const onStartDirectMessage = jest.fn();

  const contact = {
    id: 1,
    name: 'Alice Smith',
    username: 'alice',
  };

  renderModal({
    onStartDirectMessage,
    recentInteractions: [contact],
  });

  await user.click(screen.getByText('Alice Smith'));

  expect(onStartDirectMessage).toHaveBeenCalledWith({
    type: 'contact',
    action: 'message',
    value: contact,
  });
});