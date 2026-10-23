/**
 * @file ContactList.test.js
 * Tests for client/src/components/ContactList.jsx
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';

/* ---- Router: mock useNavigate ---- */
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const real = jest.requireActual('react-router-dom');
  return {
    ...real,
    useNavigate: () => mockNavigate,
    MemoryRouter: real.MemoryRouter,
  };
});

/* ---- axiosClient mock (path MUST match the component import) ---- */
jest.mock('../src/api/axiosClient', () => {
  const get = jest.fn();
  const post = jest.fn();
  const del = jest.fn();
  const patch = jest.fn();
  return {
    __esModule: true,
    default: { get, post, delete: del, patch },
  };
});
import axiosClient from '../src/api/axiosClient';

/* ---- SUT (after mocks) ---- */
import ContactList from '../src/components/ContactList.jsx';

beforeEach(() => {
  jest.clearAllMocks();
});

const renderSut = (props = {}) =>
  render(
    <MantineProvider>
      <MemoryRouter>
        <ContactList
          currentUserId={props.currentUserId ?? 1}
          onChanged={props.onChanged}
          selectionMode={props.selectionMode ?? 'single'}
          selectedIds={props.selectedIds ?? []}
          onToggleSelect={props.onToggleSelect}
        />
      </MemoryRouter>
    </MantineProvider>
  );

describe('ContactList', () => {
  test('loads and displays contacts; filters by search', async () => {
    axiosClient.get.mockResolvedValueOnce({
      data: [
        { userId: 2, alias: '', user: { username: 'alice' } },
        { userId: 3, alias: 'Bobby', user: { username: 'bob' } },
      ],
    });

    renderSut();

    expect(screen.getByText(/saved contacts/i)).toBeInTheDocument();

    // Wait for contacts to render
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('Bobby')).toBeInTheDocument();

    // Filter to "ali"
    fireEvent.change(
      screen.getByPlaceholderText(/filter saved contacts/i),
      {
        target: { value: 'ali' },
      }
    );

    // alice should remain, Bobby should be filtered out
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.queryByText('Bobby')).not.toBeInTheDocument();
  });

  test('clicking a contact starts a chat and navigates to the room', async () => {
    axiosClient.get.mockResolvedValueOnce({
      data: [{ userId: 42, alias: '', user: { username: 'zoe' } }],
    });
    axiosClient.post.mockResolvedValueOnce({ data: { id: 777 } });

    renderSut();

    // row button is rendered with the contact's display name text
    const row = await screen.findByRole('button', { name: /zoe/i });
    fireEvent.click(row);

    expect(axiosClient.post).toHaveBeenCalledWith(
      '/chatrooms/direct/42'
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/chat/777')
    );
  });

  test('delete contact calls API and refreshes the list', async () => {
    axiosClient.get
      .mockResolvedValueOnce({
        data: [{ userId: 9, alias: '', user: { username: 'nina' } }],
      }) // initial load
      .mockResolvedValueOnce({ data: [] }); // after refresh
    axiosClient.delete.mockResolvedValueOnce({ status: 200 });

    const onChanged = jest.fn();
    renderSut({ onChanged });

    expect(await screen.findByText('nina')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /delete contact/i })
    );

    await waitFor(() =>
      expect(axiosClient.delete).toHaveBeenCalledWith(
        '/contacts',
        {
          data: { ownerId: 1, userId: 9 },
        }
      )
    );

    expect(
      await screen.findByText(/no contacts found/i)
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  test('editing alias through the dialog saves and refreshes', async () => {
    axiosClient.get
      .mockResolvedValueOnce({
        data: [{ id: 5, userId: 5, alias: '', user: { username: 'amy' } }],
      })
      .mockResolvedValueOnce({
        data: [{ id: 5, userId: 5, alias: 'Bestie', user: { username: 'amy' } }],
      });

    axiosClient.patch.mockResolvedValueOnce({
      data: { id: 5, userId: 5, alias: 'Bestie', favorite: false },
    });

    renderSut();

    expect(await screen.findByText('amy')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit contact' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Alias' }), {
      target: { value: 'Bestie' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(axiosClient.patch).toHaveBeenCalledWith('/contacts', {
        userId: 5,
        alias: 'Bestie',
        favorite: false,
      });
    });

    expect(await screen.findByText('Bestie')).toBeInTheDocument();
  });

  test('multiple selection mode toggles checkboxes instead of navigating', async () => {
    // Provide one internal and one external contact to verify both IDs are supported
    axiosClient.get.mockResolvedValueOnce({
      data: [
        { userId: 11, alias: '', user: { username: 'alice' } },      // internal
        { externalPhone: '+15555550100', alias: 'Carol' },           // external
      ],
    });

    const onToggleSelect = jest.fn();

    renderSut({
      selectionMode: 'multiple',
      selectedIds: [],
      onToggleSelect,
    });

    // Both contacts appear
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();

    // Checkboxes are rendered with aria-label "Select <displayName>"
    const aliceCheckbox = screen.getByRole('checkbox', { name: /select alice/i });
    const carolCheckbox = screen.getByRole('checkbox', { name: /select carol/i });

    // Clicking the row should toggle selection (not navigate)
    const aliceRow = screen.getByRole('button', { name: /alice/i });
    fireEvent.click(aliceRow);

    expect(onToggleSelect).toHaveBeenCalledWith(11);
    expect(mockNavigate).not.toHaveBeenCalled(); // no navigation in picker mode

    // Clicking the checkbox itself should also toggle (and stop propagation)
    fireEvent.click(carolCheckbox);
    expect(onToggleSelect).toHaveBeenCalledWith('+15555550100');

    // Action buttons still exist in multiple mode.
    // Internal contact "Message" should still start DM flow.
    axiosClient.post.mockResolvedValueOnce({ data: { id: 779 } });
    const messageButtons = screen.getAllByRole('button', { name: /message/i });

    fireEvent.click(messageButtons[0]);

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledWith(
        '/chatrooms/direct/11'
      );
    });

    // External contact "Message" should route to SMS compose/lookup
    axiosClient.get.mockResolvedValueOnce({
      data: { threadId: null },
    });

    fireEvent.click(messageButtons[1]);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringMatching(/^\/sms\/compose\?to=/)
      );
    });
  });
});


describe('ContactList transport chooser regression', () => {
  const linkedContact = {
    id: 21,
    userId: 42,
    externalPhone: '+12125550123',
    alias: 'Regina',
    user: { id: 42, username: 'regina' },
  };

  test('a dual-route contact offers both choices and Chatforia opens a DM', async () => {
    axiosClient.get.mockResolvedValueOnce({ data: [linkedContact] });
    axiosClient.post.mockResolvedValueOnce({ data: { id: 777 } });
    renderSut();

    expect(await screen.findByText('Regina')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.getByRole('dialog', { name: 'Send message with' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chatforia' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SMS' })).toBeInTheDocument();
    expect(axiosClient.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Chatforia' }));
    await waitFor(() => expect(axiosClient.post).toHaveBeenCalledWith('/chatrooms/direct/42'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/chat/777'));
    expect(screen.queryByRole('dialog', { name: 'Send message with' })).not.toBeInTheDocument();
  });

  test('a dual-route contact choosing SMS opens the existing SMS thread', async () => {
    axiosClient.get
      .mockResolvedValueOnce({ data: [linkedContact] })
      .mockResolvedValueOnce({ data: { threadId: 901 } });
    renderSut();

    expect(await screen.findByText('Regina')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }));

    await waitFor(() => expect(axiosClient.get).toHaveBeenCalledWith(
      '/sms/threads/lookup',
      { params: { to: '+12125550123' } }
    ));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/sms/901'));
    expect(axiosClient.post).not.toHaveBeenCalled();
  });

  test('a Chatforia-only contact opens directly without a chooser', async () => {
    axiosClient.get.mockResolvedValueOnce({ data: [{ id: 22, userId: 44, alias: 'Alex' }] });
    axiosClient.post.mockResolvedValueOnce({ data: { id: 778 } });
    renderSut();

    expect(await screen.findByText('Alex')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.queryByRole('dialog', { name: 'Send message with' })).not.toBeInTheDocument();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/chat/778'));
  });

  test('an SMS-only contact opens directly without a chooser', async () => {
    axiosClient.get
      .mockResolvedValueOnce({ data: [{ id: 23, externalPhone: '+12125550124', alias: 'Taylor' }] })
      .mockResolvedValueOnce({ data: { threadId: null } });
    renderSut();

    expect(await screen.findByText('Taylor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(screen.queryByRole('dialog', { name: 'Send message with' })).not.toBeInTheDocument();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/sms\/compose\?to=%2B12125550124/)
    ));
    expect(axiosClient.post).not.toHaveBeenCalled();
  });
});
