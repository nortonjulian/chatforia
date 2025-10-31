/**
 * @file RecipientSelector.test.js
 * Requires:
 *   - jest
 *   - @testing-library/react
 *   - @testing-library/user-event
 *   - jsdom test environment
 *
 * Optional but recommended in jest.config:
 *   testEnvironment: 'jsdom'
 */

import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import RecipientSelector from '../RecipientSelector.jsx';

function renderWithMantine(ui) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('RecipientSelector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const setup = (props = {}) => {
    const onChange = jest.fn();
    const onRequestBrowse = jest.fn();
    const fetchSuggestions = jest.fn().mockResolvedValue([]);
    const value = props.value ?? [];
    renderWithMantine(
      <RecipientSelector
        value={value}
        onChange={onChange}
        onRequestBrowse={onRequestBrowse}
        fetchSuggestions={fetchSuggestions}
        {...props}
      />
    );
    const input = screen.getByPlaceholderText(/type a name|type a name, number, or email/i);
    return { onChange, onRequestBrowse, fetchSuggestions, input };
  };

  it('renders with label and empty state', () => {
    setup();
    expect(screen.getByText(/^to$/i)).toBeInTheDocument();
  });

  it('debounces and calls fetchSuggestions with query', async () => {
    const { fetchSuggestions, input } = setup();
    await userEvent.type(input, 'ali');
    // advance debounce (default 250ms)
    await act(async () => {
      jest.advanceTimersByTime(260);
      // allow microtasks
      await Promise.resolve();
    });
    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchSuggestions).toHaveBeenCalledWith('ali');
  });

  it('shows suggestions and adds one on click', async () => {
    const suggestion = { id: 'c_1', display: 'Alice Adams', type: 'contact', phone: '+15551234' };
    const fetchSuggestions = jest.fn().mockResolvedValue([suggestion]);
    const onChange = jest.fn();

    renderWithMantine(
      <RecipientSelector
        value={[]}
        onChange={onChange}
        onRequestBrowse={jest.fn()}
        fetchSuggestions={fetchSuggestions}
      />
    );

    const input = screen.getByPlaceholderText(/type a name/i);
    await userEvent.type(input, 'ali');

    await act(async () => {
      jest.advanceTimersByTime(260);
      await Promise.resolve();
    });

    // popover item should appear
    const item = await screen.findByText('Alice Adams');
    await userEvent.click(item);

    // onChange called with the selected recipient appended
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(Array.isArray(next)).toBe(true);
    expect(next[0]).toMatchObject({ id: 'c_1', display: 'Alice Adams' });

    // chip shows up
    expect(await screen.findByText('Alice Adams')).toBeInTheDocument();
  });

  it('adds a raw recipient when pressing Enter with no suggestions', async () => {
    const { onChange, input } = setup();
    await userEvent.type(input, 'someone@example.com');
    await act(async () => {
      jest.advanceTimersByTime(260);
      await Promise.resolve();
    });

    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0][0];
    expect(added).toMatchObject({
      id: expect.stringMatching(/^raw:/),
      display: 'someone@example.com',
      type: 'raw',
      email: 'someone@example.com',
    });
  });

  it('Backspace with empty input removes the last chip', async () => {
    const { input } = setup({
      value: [
        { id: 'c_1', display: 'Alice', type: 'contact' },
        { id: 'c_2', display: 'Bob', type: 'contact' },
      ],
      onChange: jest.fn(),
    });

    // focus input then backspace
    input.focus();
    await userEvent.keyboard('{Backspace}');

    // the last chip ("Bob") should be removed
    // because onChange is provided via props in this case, we assert via screen:
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('Browse button triggers onRequestBrowse()', async () => {
    const { onRequestBrowse, input } = setup();
    // Right-side actions include "Browse contacts" tooltip; click the user-plus icon
    // Click the action icon via tooltip text anchor
    // First, ensure input is focused so rightSection is rendered and stable
    input.focus();
    const browseButton = await screen.findByRole('button', { name: /browse contacts/i });
    await userEvent.click(browseButton);
    expect(onRequestBrowse).toHaveBeenCalledTimes(1);
  });

  it('disables adding when maxRecipients reached', async () => {
    const onChange = jest.fn();
    renderWithMantine(
      <RecipientSelector
        value={[
          { id: '1', display: 'A', type: 'contact' },
          { id: '2', display: 'B', type: 'contact' },
        ]}
        onChange={onChange}
        fetchSuggestions={jest.fn()}
        onRequestBrowse={jest.fn()}
        maxRecipients={2}
      />
    );
    const input = screen.getByPlaceholderText(/max 2 reached/i);
    expect(input).toBeDisabled();
  });

  it('keyboard navigation selects a suggestion with ArrowDown/Enter', async () => {
    const fetchSuggestions = jest.fn().mockResolvedValue([
      { id: 'c_1', display: 'Alice', type: 'contact' },
      { id: 'c_2', display: 'Albert', type: 'contact' },
    ]);
    const onChange = jest.fn();

    renderWithMantine(
      <RecipientSelector
        value={[]}
        onChange={onChange}
        onRequestBrowse={jest.fn()}
        fetchSuggestions={fetchSuggestions}
      />
    );

    const input = screen.getByPlaceholderText(/type a name/i);
    await userEvent.type(input, 'al');

    await act(async () => {
      jest.advanceTimersByTime(260);
      await Promise.resolve();
    });

    // First result is active by default; move down to second and select
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0][0];
    expect(added).toMatchObject({ id: 'c_2', display: 'Albert' });
  });

  it('shows "No matches" hint when no suggestions and Enter adds raw', async () => {
    const fetchSuggestions = jest.fn().mockResolvedValue([]);
    renderWithMantine(
      <RecipientSelector
        value={[]}
        onChange={jest.fn()}
        onRequestBrowse={jest.fn()}
        fetchSuggestions={fetchSuggestions}
      />
    );

    const input = screen.getByPlaceholderText(/type a name/i);
    await userEvent.type(input, 'zzz');
    await act(async () => {
      jest.advanceTimersByTime(260);
      await Promise.resolve();
    });

    // The popover should show the empty hint
    const popover = screen.getByText(/no matches/i);
    expect(popover).toBeInTheDocument();

    // also ensure it mentions pressing Enter
    expect(within(popover.parentElement).getByText(/press/i)).toBeInTheDocument();
  });
});
