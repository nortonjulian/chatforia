import { ActionIcon, Divider, Menu } from '@mantine/core';
import { useTranslation } from 'react-i18next';
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
  IconTrash,
} from '@tabler/icons-react';

export default function ThreadActionsMenu({
  // context
  isPremium = false,

  // toggles
  showPremiumSection = true,
  showThreadSection = true,

  // legacy permissions (groups)
  isOwnerOrAdmin = false,

  // ✅ new explicit toggles (don’t force isOwnerOrAdmin for SMS)
  canInvite = false,
  canRoomSettings = false,

  // callbacks
  onAiPower,
  onSchedule,

  onAbout,
  onSearch,
  onMedia,

  onInvitePeople,
  inviteLabel,

  onRoomSettings,

  // optional explicit upgrade row
  onUpgrade,

  // ✅ NEW: clear thread (delete-for-me / clear cutoff)
  onClear,
  clearLabel,

  // optional block row
  onBlock,
  blockLabel,
}) {
  const { t } = useTranslation();

  const resolvedInviteLabel = inviteLabel || t('threadActions.invitePeople', 'Invite people');
  const resolvedClearLabel =
    clearLabel || t('threadActions.clearConversation', 'Clear conversation');
  const resolvedBlockLabel = blockLabel || t('threadActions.block', 'Block');

  const allowInvite =
    (canInvite || isOwnerOrAdmin) && typeof onInvitePeople === 'function';

  const allowRoomSettings =
    (canRoomSettings || isOwnerOrAdmin) && typeof onRoomSettings === 'function';

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
      allowInvite ||
      allowRoomSettings ||
      typeof onClear === 'function' ||
      typeof onBlock === 'function');

  if (!hasPremiumRows && !hasThreadRows) return null;

  return (
    <Menu position="bottom-end" withinPortal shadow="md" radius="md">
      <Menu.Target>
        <ActionIcon variant="subtle" aria-label={t('threadActions.threadMenu', 'Thread menu')}>
          <IconDotsVertical size={18} />
        </ActionIcon>
      </Menu.Target>

      <Menu.Dropdown>
        {/* -------------------- Premium -------------------- */}
        {hasPremiumRows && (
          <>
            <Menu.Label>{t('threadActions.premium', 'Premium')}</Menu.Label>

            {typeof onAiPower === 'function' && (
              <Menu.Item leftSection={<IconSparkles size={16} />} onClick={onAiPower}>
                {t('threadActions.aiPower', 'AI Power')} {isPremium ? '' : t('threadActions.upgradeSuffix', '(Upgrade)')}
              </Menu.Item>
            )}

            {typeof onSchedule === 'function' && (
              <Menu.Item leftSection={<IconCalendarPlus size={16} />} onClick={onSchedule}>
                {t('threadActions.schedule', 'Schedule')} {isPremium ? '' : t('threadActions.upgradeSuffix', '(Upgrade)')}
              </Menu.Item>
            )}

            {typeof onUpgrade === 'function' && (
              <Menu.Item leftSection={<IconArrowUpRight size={16} />} onClick={onUpgrade}>
                {t('threadActions.upgrade', 'Upgrade')}
              </Menu.Item>
            )}

            {hasThreadRows && <Divider my="xs" />}
          </>
        )}

        {/* -------------------- Thread -------------------- */}
        {hasThreadRows && (
          <>
            <Menu.Label>{t('threadActions.thread', 'Thread')}</Menu.Label>

            {typeof onAbout === 'function' && (
              <Menu.Item leftSection={<IconInfoCircle size={16} />} onClick={onAbout}>
                {t('threadActions.about', 'About')}
              </Menu.Item>
            )}

            {typeof onSearch === 'function' && (
              <Menu.Item leftSection={<IconSearch size={16} />} onClick={onSearch}>
                {t('threadActions.search', 'Search')}
              </Menu.Item>
            )}

            {typeof onMedia === 'function' && (
              <Menu.Item leftSection={<IconPhoto size={16} />} onClick={onMedia}>
                {t('threadActions.media', 'Media')}
              </Menu.Item>
            )}

            {allowInvite && (
              <Menu.Item leftSection={<IconUserPlus size={16} />} onClick={onInvitePeople}>
                {resolvedInviteLabel}
              </Menu.Item>
            )}

            {allowRoomSettings && (
              <Menu.Item leftSection={<IconSettings size={16} />} onClick={onRoomSettings}>
                {t('threadActions.roomSettings', 'Room settings')}
              </Menu.Item>
            )}

            {typeof onClear === 'function' && (
              <>
                <Divider my="xs" />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={onClear}
                >
                  {resolvedClearLabel}
                </Menu.Item>
              </>
            )}

            {typeof onBlock === 'function' && (
              <>
                <Divider my="xs" />
                <Menu.Item color="red" leftSection={<IconBan size={16} />} onClick={onBlock}>
                  {resolvedBlockLabel}
                </Menu.Item>
              </>
            )}
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}