/**
 * @file RecipientSelector.test.js
 */

jest.mock('@mantine/core', () => {
  const React = require('react');

  const make = (tag) =>
    React.forwardRef((props, ref) =>
      React.createElement(
        tag,
        { ...props, ref, 'data-mantine': tag },
        props.children
      )
    );

  const Input = make('div');
  Input.Label = React.forwardRef((props, ref) =>
    React.createElement(
      'label',
      { ...props, ref, 'data-mantine': 'label' },
      props.children
    )
  );

  const ScrollArea = make('div');
  ScrollArea.Autosize = make('div');

  const Popover = make('div');
  Popover.Target = make('div');
  Popover.Dropdown = make('div');

  const TextInput = React.forwardRef(({ rightSection, ...props }, ref) =>
    React.createElement(
      'div',
      { 'data-mantine': 'text-input' },
      React.createElement('input', {
        ...props,
        ref,
        'data-mantine': 'input',
      }),
      rightSection
    )
  );

  return {
    __esModule: true,

    ActionIcon: React.forwardRef((props, ref) =>
      React.createElement(
        'button',
        { ...props, ref, type: 'button', 'data-mantine': 'action-icon' },
        props.children
      )
    ),

    Box: make('div'),

    CloseButton: React.forwardRef((props, ref) =>
      React.createElement(
        'button',
        { ...props, ref, type: 'button', 'data-mantine': 'close-button' },
        props.children
      )
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

    Tooltip: ({ label, children }) => {
      if (React.isValidElement(children)) {
        return React.cloneElement(children, {
          'aria-label': label,
          title: label,
        });
      }

      return children;
    },
  };
});

jest.mock('@tabler/icons-react', () => {
  const React = require('react');
  const Icon = (props) => React.createElement('svg', props);

  return {
    __esModule: true,
    IconChevronsDown: Icon,
  };
});

import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecipientSelector from '@/components/RecipientSelector.jsx';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = jest.fn();
  }

  if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  }
});

function renderWithMantine(ui) {
  return render(ui);
}

describe('RecipientSelector', () => {
  const setup = (props = {}) => {
    const onChange = props.onChange ?? jest.fn();
    const fetchSuggestions =
      props.fetchSuggestions ?? jest.fn().mockResolvedValue([]);
    const value = props.value ?? [];

    renderWithMantine(
      <RecipientSelector
        value={value}
        onChange={onChange}
        fetchSuggestions={fetchSuggestions}
        {...props}
      />
    );

    const input = screen.getByPlaceholderText(
      /type a name|type a name, number, or email/i
    );

    return { onChange, fetchSuggestions, input };
  };

  it('renders with label', () => {
    setup();

    expect(screen.getByText(/^to$/i)).toBeInTheDocument();
  });

  it('debounces and calls fetchSuggestions with query', async () => {
    const { fetchSuggestions, input } = setup();

    await userEvent.type(input, 'ali');

    await waitFor(() => {
      expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    });

    expect(fetchSuggestions).toHaveBeenCalledWith('ali');
  });

  it('shows suggestions and adds one on click', async () => {
    const suggestion = {
      id: 'c_1',
      display: 'Alice Adams',
      type: 'contact',
      phone: '+15551234',
    };

    const fetchSuggestions = jest.fn().mockResolvedValue([suggestion]);
    const onChange = jest.fn();

    renderWithMantine(
      <RecipientSelector
        value={[]}
        onChange={onChange}
        fetchSuggestions={fetchSuggestions}
      />
    );

    const input = screen.getByPlaceholderText(/type a name/i);

    await userEvent.type(input, 'ali');

    const item = await screen.findByText('Alice Adams');
    await userEvent.click(item);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      id: 'c_1',
      display: 'Alice Adams',
    });
  });

  it('adds a raw email recipient when pressing Enter with no suggestions', async () => {
    const { onChange, input } = setup();

    await userEvent.type(input, 'someone@example.com');
    await userEvent.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledTimes(1);

    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      id: expect.stringMatching(/^raw:/),
      display: 'someone@example.com',
      type: 'raw',
      email: 'someone@example.com',
    });
  });

  it('adds a raw phone recipient when pressing Enter with no suggestions', async () => {
    const { onChange, input } = setup();

    await userEvent.type(input, '555-555-5555');
    await userEvent.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledTimes(1);

    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      id: 'raw:+15555555555',
      display: '555-555-5555',
      type: 'raw',
      phone: '+15555555555',
    });
  });

  it('Backspace with empty input removes the last chip', async () => {
    const { input, onChange } = setup({
      value: [
        { id: 'c_1', display: 'Alice', type: 'contact' },
        { id: 'c_2', display: 'Bob', type: 'contact' },
      ],
    });

    input.focus();

    await userEvent.keyboard('{Backspace}');

    expect(onChange).toHaveBeenCalledTimes(1);

    expect(onChange.mock.calls[0][0]).toEqual([
      { id: 'c_1', display: 'Alice', type: 'contact' },
    ]);
  });

  it('shows the recipient expander button when multiple recipients exist', () => {
    setup({
      value: [
        { id: '1', display: 'Alice', type: 'contact' },
        { id: '2', display: 'Bob', type: 'contact' },
      ],
    });

    expect(
      screen.getByRole('button', { name: /show all recipients/i })
    ).toBeInTheDocument();
  });

  it('disables adding when maxRecipients reached', () => {
    const onChange = jest.fn();

    renderWithMantine(
      <RecipientSelector
        value={[
          { id: '1', display: 'A', type: 'contact' },
          { id: '2', display: 'B', type: 'contact' },
        ]}
        onChange={onChange}
        fetchSuggestions={jest.fn()}
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
        fetchSuggestions={fetchSuggestions}
      />
    );

    const input = screen.getByPlaceholderText(/type a name/i);

    await userEvent.type(input, 'al');

    await screen.findByText('Alice');

    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledTimes(1);

    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      id: 'c_2',
      display: 'Albert',
    });
  });

  it('shows "No matches" hint when no suggestions and raw adding is allowed', async () => {
    const fetchSuggestions = jest.fn().mockResolvedValue([]);

    renderWithMantine(
      <RecipientSelector
        value={[]}
        onChange={jest.fn()}
        fetchSuggestions={fetchSuggestions}
      />
    );

    const input = screen.getByPlaceholderText(/type a name/i);

    await userEvent.type(input, 'zzz');

    const popover = await screen.findByText(/no matches/i);

    expect(popover).toBeInTheDocument();
    expect(within(popover.parentElement).getByText(/press/i)).toBeInTheDocument();
  });
});