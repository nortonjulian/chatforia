import { Tooltip, Group, Text, ActionIcon, Menu, Box } from '@mantine/core';
import { RotateCw, MoreVertical, Pencil, Trash2, CalendarPlus } from 'lucide-react';
import dayjs from 'dayjs';

function normalizeAttachments(msg) {
  const a = Array.isArray(msg?.attachments) ? msg.attachments : [];
  const b = Array.isArray(msg?.attachmentsInline) ? msg.attachmentsInline : [];
  return [...a, ...b].filter(Boolean);
}

function isImage(mime, url) {
  const s = String(mime || '').toLowerCase();
  const u = String(url || '').toLowerCase();
  return s.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(u);
}
function isVideo(mime, url) {
  const s = String(mime || '').toLowerCase();
  const u = String(url || '').toLowerCase();
  return s.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(u);
}
function isAudio(mime, url) {
  const s = String(mime || '').toLowerCase();
  const u = String(url || '').toLowerCase();
  return s.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|webm)$/i.test(u);
}

export default function MessageBubble({
  msg,
  currentUserId, // ✅ add this so "mine" is reliable
  onRetry,
  onEdit,
  onDeleteMe,
  onDeleteAll,
  onAddToCalendar,
  canEdit = false,
  canDeleteAll = false,
}) {
  const ts = dayjs(msg.createdAt).format('MMM D, YYYY • h:mm A');

  const isTombstone =
    Boolean(msg.deletedForAll) ||
    msg.type === 'DELETED' ||
    msg.systemType === 'deleted';

  // ✅ derive "mine" from sender vs current user (don't depend on msg.mine existing)
  const mine = Number(msg?.sender?.id ?? msg?.senderId) === Number(currentUserId);

  // ✅ pick the best available display text (matches your backend shaping)
  const displayText = isTombstone
    ? 'This message was deleted'
    : (msg.translatedForMe ?? msg.rawContent ?? msg.content ?? '');

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

  const hasDeleteMe = typeof onDeleteMe === 'function';
  const hasAddToCalendar = typeof onAddToCalendar === 'function';

  // ✅ enforce safety locally too (prevents showing actions on non-mine messages)
  const canEditHere = !isTombstone && mine && canEdit;
  const canDeleteAllHere = !isTombstone && mine && canDeleteAll;

  const hasAnyActions =
    !isTombstone && (canEditHere || canDeleteAllHere || hasDeleteMe || hasAddToCalendar);

  const attachments = normalizeAttachments(msg);

  console.log('menu-check', {
    id: msg?.id,
    mine,
    isTombstone,
    canEdit: canEditHere,
    canDeleteAll: canDeleteAllHere,
    hasOnDeleteMe: hasDeleteMe,
    hasAddToCalendar,
    attachmentsCount: attachments.length,
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
        {/* ✅ Menu anchor */}
        {hasAnyActions && (
          <Box
            style={{
              position: 'absolute',
              top: 8,
              right: mine ? 8 : 'auto',
              left: mine ? 'auto' : 8,
              zIndex: 50,
              pointerEvents: 'auto',
            }}
            onClick={(e) => {
              // ✅ extra guard if parent rows have click handlers
              e.preventDefault();
              e.stopPropagation();
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
                {/* ✅ Calendar (message-level action) */}
                {hasAddToCalendar && (
                  <Menu.Item
                    leftSection={<CalendarPlus size={16} />}
                    onClick={() => onAddToCalendar?.(msg)}
                  >
                    Add to calendar
                  </Menu.Item>
                )}

                {canEditHere && (
                  <Menu.Item leftSection={<Pencil size={16} />} onClick={() => onEdit?.(msg)}>
                    Edit
                  </Menu.Item>
                )}

                {hasDeleteMe && (
                  <Menu.Item
                    color="red"
                    leftSection={<Trash2 size={16} />}
                    onClick={() => onDeleteMe?.(msg)}
                  >
                    Delete for me
                  </Menu.Item>
                )}

                {canDeleteAllHere && (
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
              paddingTop: hasAnyActions ? 28 : 8,
            }}
          >
            {displayText}
            {Boolean(msg.editedAt) && !isTombstone ? (
              <Text component="span" size="xs" ml={8} style={{ opacity: 0.85 }}>
                (edited)
              </Text>
            ) : null}
          </Text>
        </Tooltip>

        {/* ✅ Attachments (images/video/audio/files) */}
        {!isTombstone && attachments.length > 0 ? (
          <Box mt={8} style={{ width: '100%' }}>
            <Group gap="xs" wrap="wrap" justify={mine ? 'flex-end' : 'flex-start'}>
              {attachments.map((a, i) => {
                const url = a?.url;
                const mime = a?.mimeType;

                if (!url) return null;

                if (isAudio(mime, url)) {
                  return (
                    <audio
                      key={a.id ?? `${url}-${i}`}
                      controls
                      style={{ width: 260, maxWidth: '100%' }}
                    >
                      <source src={url} />
                    </audio>
                  );
                }

                if (isVideo(mime, url)) {
                  return (
                    <video
                      key={a.id ?? `${url}-${i}`}
                      controls
                      style={{ width: 260, maxWidth: '100%', borderRadius: 12 }}
                    >
                      <source src={url} />
                    </video>
                  );
                }

                if (isImage(mime, url)) {
                  const imgSrc = a.thumbUrl || a.thumbnailUrl || url; // ✅ prefer thumb if present
                  return (
                    <a
                      key={a.id ?? `${url}-${i}`}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'inline-block' }}
                    >
                      <img
                        src={imgSrc}
                        alt="Attachment"
                        style={{ width: 180, maxWidth: '100%', borderRadius: 12 }}
                      />
                    </a>
                  );
                }

                // generic file
                return (
                  <a
                    key={a.id ?? `${url}-${i}`}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'underline' }}
                  >
                    {a.originalName || a.caption || 'Open file'}
                  </a>
                );
              })}
            </Group>
          </Box>
        ) : null}

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
