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

  test('editing alias triggers PATCH on blur', async () => {
    axiosClient.get
      .mockResolvedValueOnce({
        data: [{ userId: 5, alias: '', user: { username: 'amy' } }],
      }) // initial
      .mockResolvedValueOnce({
        data: [
          {
            userId: 5,
            alias: 'Bestie',
            user: { username: 'amy' },
          },
        ],
      }); // refresh after PATCH
    axiosClient.patch.mockResolvedValueOnce({ status: 200 });

    renderSut();

    expect(await screen.findByText('amy')).toBeInTheDocument();

    const aliasInput = screen.getByPlaceholderText(/alias/i);
    fireEvent.change(aliasInput, {
      target: { value: 'Bestie' },
    });
    fireEvent.blur(aliasInput);

    await waitFor(() =>
      expect(axiosClient.patch).toHaveBeenCalledWith(
        '/contacts',
        {
          ownerId: 1,
          userId: 5,
          alias: 'Bestie',
        }
      )
    );

    expect(
      await screen.findByText('Bestie')
    ).toBeInTheDocument();
  });
});