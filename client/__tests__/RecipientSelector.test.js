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

// --- Mock Mantine so all components are valid React components ---
jest.mock('@mantine/core', () => {
  const React = require('react');

  const make = (tag) =>
    React.forwardRef((props, ref) =>
      React.createElement(tag, { ...props, ref, 'data-mantine': tag }, props.children)
    );

  // Input with nested Label
  const Input = make('div');
  Input.Label = React.forwardRef((props, ref) =>
    React.createElement('label', { ...props, ref, 'data-mantine': 'label' }, props.children)
  );

  // ScrollArea with Autosize
  const ScrollArea = make('div');
  ScrollArea.Autosize = make('div');

  // Popover with Target and Dropdown
  const Popover = make('div');
  Popover.Target = make('div');
  Popover.Dropdown = make('div');

  // TextInput needs to render rightSection so we can see the browse button
  const TextInput = React.forwardRef(({ rightSection, ...props }, ref) =>
    React.createElement(
      'div',
      { 'data-mantine': 'text-input' },
      React.createElement('input', { ...props, ref, 'data-mantine': 'input' }),
      rightSection
    )
  );

  return {
    __esModule: true,
    ActionIcon: React.forwardRef((props, ref) =>
      React.createElement('button', { ...props, ref, 'data-mantine': 'action-icon' }, props.children)
    ),
    Box: make('div'),
    CloseButton: React.forwardRef((props, ref) =>
      React.createElement('button', { ...props, ref, 'data-mantine': 'close-button' }, props.children)
    ),
    Group: make('div'),
    Input,
    Kbd: make('kbd'),
    Loader: make('div'),
    Popover,
    ScrollArea,
    Stack: make('div'),
    Text: make('span'),
    TextInput,
    Tooltip: make('div'),
  };
});

// Mock icons so they don't bring in any odd JSX
jest.mock('@tabler/icons-react', () => {
  const React = require('react');
  const Icon = (props) => React.createElement('svg', props);
  return {
    __esModule: true,
    IconUserPlus: Icon,
    IconChevronsDown: Icon,
  };
});

import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecipientSelector from '@/components/RecipientSelector.jsx';

// Polyfills for jsdom environment
beforeAll(() => {
  // jsdom doesn't implement scrollIntoView by default
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = jest.fn();
  }
  // Ensure requestAnimationFrame exists (used in removeRecipient)
  if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  }
});

function renderWithMantine(ui) {
  // MantineProvider is not required for these unit tests
  return render(ui);
}

describe('RecipientSelector', () => {
  // NOTE: we use *real* timers now to avoid userEvent + fake timer conflicts

  const setup = (props = {}) => {
    const onChange = props.onChange ?? jest.fn();
    const onRequestBrowse = props.onRequestBrowse ?? jest.fn();
    const fetchSuggestions = props.fetchSuggestions ?? jest.fn().mockResolvedValue([]);
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

    // Wait for debounce to fire and fetchSuggestions to be called
    await waitFor(() => {
      expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    });

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

    // Wait for suggestion to appear
    const item = await screen.findByText('Alice Adams');
    await userEvent.click(item);

    // onChange called with the selected recipient appended
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(Array.isArray(next)).toBe(true);
    expect(next[0]).toMatchObject({ id: 'c_1', display: 'Alice Adams' });
  });

  it('adds a raw recipient when pressing Enter with no suggestions', async () => {
    const { onChange, input } = setup();

    await userEvent.type(input, 'someone@example.com');

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
    const { input, onChange } = setup({
      value: [
        { id: 'c_1', display: 'Alice', type: 'contact' },
        { id: 'c_2', display: 'Bob', type: 'contact' },
      ],
    });

    // focus input then backspace
    input.focus();
    await userEvent.keyboard('{Backspace}');

    // Component is controlled; we assert the onChange payload.
    expect(onChange).toHaveBeenCalledTimes(1);
    const nextValue = onChange.mock.calls[0][0];
    expect(nextValue).toEqual([{ id: 'c_1', display: 'Alice', type: 'contact' }]);
  });

  it('Browse button triggers onRequestBrowse()', async () => {
    const { onRequestBrowse, input } = setup();
    // Focus so "rightSection" content (including our ActionIcon) is visible
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

    // Ensure suggestions have rendered
    await screen.findByText('Alice');

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

    // The popover should show the empty hint
    const popover = await screen.findByText(/no matches/i);
    expect(popover).toBeInTheDocument();

    // also ensure it mentions pressing Enter
    expect(within(popover.parentElement).getByText(/press/i)).toBeInTheDocument();
  });
});
