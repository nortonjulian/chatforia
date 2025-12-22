import { Tooltip, Group, Text, ActionIcon, Menu, Box } from '@mantine/core';
import { RotateCw, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import dayjs from 'dayjs';

export default function MessageBubble({
  msg,
  onRetry,
  onEdit,
  onDeleteMe,
  onDeleteAll,
  canEdit = false,
  canDeleteAll = false,
}) {
  const ts = dayjs(msg.createdAt).format('MMM D, YYYY • h:mm A');

  const isTombstone =
    Boolean(msg.deletedForAll) ||
    msg.type === 'DELETED' ||
    msg.systemType === 'deleted';

  const mine = Boolean(msg.mine);

  const bubbleStyle = mine
    ? {
        background: 'var(--bubble-outgoing, linear-gradient(135deg, #6A3CC1, #00C2A8))',
        color: 'var(--bubble-outgoing-text, #fff)',
        textShadow: 'var(--bubble-outgoing-shadow, none)',
      }
    : {
        background: 'var(--bubble-incoming, #f3f4f6)',
        color: 'var(--bubble-incoming-text, #111)',
      };

      console.log('menu-check', {
        id: msg?.id,
        mine,
        isTombstone,
        canEdit,
        canDeleteAll,
        hasOnDeleteMe: typeof onDeleteMe === 'function',
      });

  return (
  <Group justify={mine ? 'flex-end' : 'flex-start'} wrap="nowrap" align="flex-end" px="md">
    <Box
      style={{
        maxWidth: '68%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: mine ? 'flex-end' : 'flex-start',
        gap: 4,
        minWidth: 0,
      }}
    >
  

      {/* ✅ Force-visible menu anchor (no negative offsets) */}
      {!isTombstone && (canEdit || canDeleteAll || typeof onDeleteMe === 'function') && (
        <Box
          style={{
            position: 'absolute',
            top: 8,
            right: mine ? 8 : 'auto',
            left: mine ? 'auto' : 8,
            zIndex: 50,
            pointerEvents: 'auto',
          }}
        >
          <Menu position="bottom-end" withinPortal shadow="md" radius="md">
            <Menu.Target>
              <ActionIcon
                aria-label="Message actions"
                variant="filled"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <MoreVertical size={16} />
              </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
              {canEdit && (
                <Menu.Item leftSection={<Pencil size={16} />} onClick={() => onEdit?.(msg)}>
                  Edit
                </Menu.Item>
              )}

              <Menu.Item
                color="red"
                leftSection={<Trash2 size={16} />}
                onClick={() => onDeleteMe?.(msg)}
              >
                Delete for me
              </Menu.Item>

              {canDeleteAll && (
                <Menu.Item
                  color="red"
                  leftSection={<Trash2 size={16} />}
                  onClick={() => onDeleteAll?.(msg)}
                >
                  Delete for everyone
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </Box>
      )}

      {/* Bubble */}
      <Tooltip label={ts} withinPortal>
        <Text
          role="text"
          aria-label={`Message sent ${ts}`}
          px="md"
          py={8}
          style={{
            ...bubbleStyle,
            borderRadius: 18,
            wordBreak: 'break-word',
            opacity: isTombstone ? 0.75 : 1,
            fontStyle: isTombstone ? 'italic' : 'normal',

            // ✅ reserve space so the icon never overlaps text
            paddingTop: 28,
          }}
        >
          {isTombstone ? 'This message was deleted' : (msg.content || '')}
          {Boolean(msg.editedAt) && !isTombstone ? (
            <Text component="span" size="xs" ml={8} style={{ opacity: 0.85 }}>
              (edited)
            </Text>
          ) : null}
        </Text>
      </Tooltip>

      {/* Retry */}
      {msg.failed && (
        <ActionIcon
          aria-label="Retry sending message"
          variant="subtle"
          onClick={() => onRetry?.(msg)}
          title="Retry"
        >
          <RotateCw size={18} />
        </ActionIcon>
      )}
    </Box>
  </Group>
 );
}

