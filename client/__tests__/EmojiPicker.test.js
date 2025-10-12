import { render, screen, fireEvent } from '@testing-library/react';
import CustomEmojiPicker from '@/components/EmojiPicker'; // update path if needed

// ---- Mocks ----

// Minimal Mantine Popover mock with Target/Dropdown statics
jest.mock('@mantine/core', () => {
  const React = require('react');

  const ActionIcon = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>
      {children}
    </button>
  );

  const Popover = ({ opened, children }) => {
    const kids = React.Children.toArray(children);
    const Target = kids.find(
      (c) => c?.type?.displayName === 'Popover.Target'
    );
    const Dropdown = kids.find(
      (c) => c?.type?.displayName === 'Popover.Dropdown'
    );
    return (
      <div data-testid="popover">
        {/* Render target always */}
        {Target?.props?.children}
        {/* Conditionally render dropdown content */}
        {opened ? <div data-testid="dropdown">{Dropdown?.props?.children}</div> : null}
      </div>
    );
  };

  const PT = ({ children }) => <>{children}</>;
  PT.displayName = 'Popover.Target';
  const PD = ({ children, ...p }) => <div {...p}>{children}</div>;
  PD.displayName = 'Popover.Dropdown';
  Popover.Target = PT;
  Popover.Dropdown = PD;

  return { ActionIcon, Popover };
});

// Emoji picker lib → render a button that triggers onEmojiClick
jest.mock('emoji-picker-react', () => {
  const React = require('react');
  return function EmojiPickerMock({ onEmojiClick }) {
    return (
      <div data-testid="emoji-picker">
        <button type="button" onClick={() => onEmojiClick({ emoji: '😀' })}>
          😀
        </button>
      </div>
    );
  };
});

// Icon (not important to behavior)
jest.mock('@tabler/icons-react', () => ({
  IconMoodSmile: (props) => <span data-testid="smile-icon" {...props} />,
}));

describe('CustomEmojiPicker', () => {
  test('is closed by default, opens on icon click, selects emoji then closes', () => {
    const onSelect = jest.fn();
    render(<CustomEmojiPicker onSelect={onSelect} />);

    // Popover closed initially (no dropdown content)
    expect(screen.queryByTestId('dropdown')).not.toBeInTheDocument();
    expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument();

    // Click the action icon -> opens
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    expect(screen.getByTestId('dropdown')).toBeInTheDocument();
    expect(screen.getByTestId('emoji-picker')).toBeInTheDocument();

    // Click an emoji -> calls onSelect and closes popover
    fireEvent.click(screen.getByText('😀'));
    expect(onSelect).toHaveBeenCalledWith('😀');
    expect(screen.queryByTestId('dropdown')).not.toBeInTheDocument();
    expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument();
  });

  test('toggle: clicking the icon again closes the popover', () => {
    render(<CustomEmojiPicker onSelect={() => {}} />);

    const trigger = screen.getByRole('button');
    // open
    fireEvent.click(trigger);
    expect(screen.getByTestId('dropdown')).toBeInTheDocument();

    // close via toggle
    fireEvent.click(trigger);
    expect(screen.queryByTestId('dropdown')).not.toBeInTheDocument();
  });
});
