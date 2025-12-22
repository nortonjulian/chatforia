import { ActionIcon, Divider, Menu } from '@mantine/core';
import {
  IconDotsVertical,
  IconSparkles,
  IconCalendarPlus,
  IconInfoCircle,
  IconSearch,
  IconPhoto,
  IconUserPlus,
  IconSettings,
  IconArrowUpRight,
  IconBan,
} from '@tabler/icons-react';

/**
 * ThreadActionsMenu
 *
 * Shared 3-dot menu for:
 *  - app-to-app chats (1:1 + groups)
 *  - SMS threads
 *
 * Goal: SMS menu should look identical to chat menu (icons, spacing, labels),
 * just with fewer items.
 */
export default function ThreadActionsMenu({
  // context
  isPremium = false,

  // toggles
  showPremiumSection = true,
  showThreadSection = true,

  // permissions (groups)
  isOwnerOrAdmin = false,

  // callbacks
  onAiPower,
  onSchedule,

  onAbout,
  onSearch,
  onMedia,

  onInvitePeople,
  onRoomSettings,

  // optional explicit upgrade row (usually NOT needed if you show AI+Schedule with (Upgrade))
  onUpgrade,

  // optional block row
  onBlock,
  blockLabel = 'Block',
}) {
  const hasPremiumRows =
    showPremiumSection &&
    (typeof onAiPower === 'function' ||
      typeof onSchedule === 'function' ||
      typeof onUpgrade === 'function');

  const hasThreadRows =
    showThreadSection &&
    (typeof onAbout === 'function' ||
      typeof onSearch === 'function' ||
      typeof onMedia === 'function' ||
      (isOwnerOrAdmin && typeof onInvitePeople === 'function') ||
      (isOwnerOrAdmin && typeof onRoomSettings === 'function') ||
      typeof onBlock === 'function');

  // Nothing to render
  if (!hasPremiumRows && !hasThreadRows) return null;

  return (
    <Menu position="bottom-end" withinPortal shadow="md" radius="md">
      <Menu.Target>
        <ActionIcon variant="subtle" aria-label="Thread menu">
          <IconDotsVertical size={18} />
        </ActionIcon>
      </Menu.Target>

      <Menu.Dropdown>
        {/* -------------------- Premium -------------------- */}
        {hasPremiumRows && (
          <>
            <Menu.Label>Premium</Menu.Label>

            {typeof onAiPower === 'function' && (
              <Menu.Item leftSection={<IconSparkles size={16} />} onClick={onAiPower}>
                AI Power {isPremium ? '' : '(Upgrade)'}
              </Menu.Item>
            )}

            {typeof onSchedule === 'function' && (
              <Menu.Item leftSection={<IconCalendarPlus size={16} />} onClick={onSchedule}>
                Schedule {isPremium ? '' : '(Upgrade)'}
              </Menu.Item>
            )}

            {/* Optional: explicit Upgrade row (only use if you WANT it) */}
            {typeof onUpgrade === 'function' && (
              <Menu.Item leftSection={<IconArrowUpRight size={16} />} onClick={onUpgrade}>
                Upgrade
              </Menu.Item>
            )}

            {hasThreadRows && <Divider my="xs" />}
          </>
        )}

        {/* -------------------- Thread -------------------- */}
        {hasThreadRows && (
          <>
            <Menu.Label>Thread</Menu.Label>

            {typeof onAbout === 'function' && (
              <Menu.Item leftSection={<IconInfoCircle size={16} />} onClick={onAbout}>
                About
              </Menu.Item>
            )}

            {typeof onSearch === 'function' && (
              <Menu.Item leftSection={<IconSearch size={16} />} onClick={onSearch}>
                Search
              </Menu.Item>
            )}

            {typeof onMedia === 'function' && (
              <Menu.Item leftSection={<IconPhoto size={16} />} onClick={onMedia}>
                Media
              </Menu.Item>
            )}

            {isOwnerOrAdmin && typeof onInvitePeople === 'function' && (
              <Menu.Item leftSection={<IconUserPlus size={16} />} onClick={onInvitePeople}>
                Invite people
              </Menu.Item>
            )}

            {isOwnerOrAdmin && typeof onRoomSettings === 'function' && (
              <Menu.Item leftSection={<IconSettings size={16} />} onClick={onRoomSettings}>
                Room settings
              </Menu.Item>
            )}

            {typeof onBlock === 'function' && (
              <>
                <Divider my="xs" />
                <Menu.Item color="red" leftSection={<IconBan size={16} />} onClick={onBlock}>
                  {blockLabel}
                </Menu.Item>
              </>
            )}
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
