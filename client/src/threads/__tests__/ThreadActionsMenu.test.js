import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

jest.mock('@tabler/icons-react', () => {
  const Icon = () => <span data-testid="icon" />;
  return {
    IconDotsVertical: Icon,
    IconSparkles: Icon,
    IconCalendarPlus: Icon,
    IconInfoCircle: Icon,
    IconSearch: Icon,
    IconPhoto: Icon,
    IconUserPlus: Icon,
    IconSettings: Icon,
    IconArrowUpRight: Icon,
    IconBan: Icon,
    IconTrash: Icon,
  };
});

jest.mock('@mantine/core', () => {
  const Menu = ({ children }) => <div>{children}</div>;
  Menu.Target = ({ children }) => <div>{children}</div>;
  Menu.Dropdown = ({ children }) => <div>{children}</div>;
  Menu.Label = ({ children }) => <div>{children}</div>;
  Menu.Item = ({ children, onClick }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );

  return {
    ActionIcon: ({ children, ...props }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Divider: () => <hr />,
    Menu,
  };
});

import ThreadActionsMenu from '../ThreadActionsMenu';

describe('ThreadActionsMenu AI entitlement display', () => {
  test('shows Summarize conversation without upgrade suffix when FULL AI is available', () => {
    const onAiPower = jest.fn();

    render(
      <ThreadActionsMenu
        isPremium={false}
        isAiPowerAvailable
        aiPowerLabel="Summarize conversation"
        showPremiumSection
        showThreadSection={false}
        onAiPower={onAiPower}
      />
    );

    const item = screen.getByRole('button', {
      name: /summarize conversation/i,
    });

    expect(item).toBeInTheDocument();
    expect(item).not.toHaveTextContent('(Upgrade)');

    fireEvent.click(item);
    expect(onAiPower).toHaveBeenCalledTimes(1);
  });

  test('shows upgrade suffix when FULL AI is unavailable', () => {
    render(
      <ThreadActionsMenu
        isPremium
        isAiPowerAvailable={false}
        aiPowerLabel="Summarize conversation"
        showPremiumSection
        showThreadSection={false}
        onAiPower={() => {}}
      />
    );

    expect(
      screen.getByRole('button', {
        name: /summarize conversation.*upgrade/i,
      })
    ).toBeInTheDocument();
  });

  test('preserves legacy SMS AI Power behavior when explicit AI availability is omitted', () => {
    render(
      <ThreadActionsMenu
        isPremium
        showPremiumSection
        showThreadSection={false}
        onAiPower={() => {}}
      />
    );

    const item = screen.getByRole('button', {
      name: /ai power/i,
    });

    expect(item).toBeInTheDocument();
    expect(item).not.toHaveTextContent('(Upgrade)');
  });
  test('shows Schedule as upgrade-only when strict Premium is unavailable', () => {
    render(
      <ThreadActionsMenu
        isPremium
        isScheduleAvailable={false}
        showPremiumSection
        showThreadSection={false}
        onSchedule={() => {}}
      />
    );

    expect(
      screen.getByRole('button', {
        name: /schedule.*upgrade/i,
      })
    ).toBeInTheDocument();
  });

  test('shows Schedule unlocked for strict Premium', () => {
    render(
      <ThreadActionsMenu
        isPremium
        isScheduleAvailable
        showPremiumSection
        showThreadSection={false}
        onSchedule={() => {}}
      />
    );

    const item = screen.getByRole('button', {
      name: /^schedule$/i,
    });

    expect(item).toBeInTheDocument();
    expect(item).not.toHaveTextContent('(Upgrade)');
  });

});
