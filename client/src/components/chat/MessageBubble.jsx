import { Tooltip, Text, ActionIcon, Menu, Box, Group } from '@mantine/core';
import {
  RotateCw,
  MoreVertical,
  Pencil,
  Trash2,
  CalendarPlus,
  ShieldAlert,
} from 'lucide-react';
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

function messageHasDate(text = '') {
  const t = text.toLowerCase();

  const patterns = [
    /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/,     // 7pm, 7:30 pm
    /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,   // 3/15 or 3/15/2026
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/,
    /\b(today|tomorrow|tonight)\b/,
  ];

  return patterns.some((p) => p.test(t));
}

export default function MessageBubble({
  msg,
  currentUserId,
  onRetry,
  onEdit,
  onDeleteMe,
  onDeleteAll,
  onAddToCalendar,
  onReport,
  canEdit = false,
  canDeleteAll = false,
  showTail = false,
  sameAsPrev = false,
}) {
  const ts = dayjs(msg.createdAt).format('MMM D, YYYY • h:mm A');

  const isTombstone =
    Boolean(msg.deletedForAll) ||
    msg.type === 'DELETED' ||
    msg.systemType === 'deleted';

  const mine = Number(msg?.sender?.id ?? msg?.senderId) === Number(currentUserId);

  const displayText = isTombstone
  ? 'This message was deleted'
  : (
      msg.content ??
      msg.decryptedContent ??
      msg.translatedForMe ??
      msg.rawContent ??
      (msg.contentCiphertext ? '[Encrypted message — unlock your key to view]' : '')
    );

  const bubbleStyle = mine
    ? {
        background: 'var(--bubble-outgoing, #f7a600)',
        color: 'var(--bubble-outgoing-text, #111)',
        textShadow: 'var(--bubble-outgoing-shadow, none)',
      }
    : {
        background: 'var(--bubble-incoming-bg, #f3f4f6)',
        color: 'var(--bubble-incoming-fg, var(--bubble-incoming-text, #111))',
      };

  const hasDeleteMe = typeof onDeleteMe === 'function';

  const hasAddToCalendar =
  typeof onAddToCalendar === 'function' &&
  messageHasDate(displayText);

  const hasReport = typeof onReport === 'function';

  const canEditHere = !isTombstone && mine && canEdit;
  const canDeleteAllHere = !isTombstone && mine && canDeleteAll;

  const hasAnyActions =
    !isTombstone &&
    (canEditHere || canDeleteAllHere || hasDeleteMe || hasAddToCalendar || hasReport);

  const attachments = normalizeAttachments(msg);

  const tailBg = mine
    ? 'var(--bubble-outgoing, #f7a600)'
    : 'var(--bubble-incoming, #f3f4f6)';

  return (
    <Box
      px="md"
      className="message-row"
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: mine ? 'flex-end' : 'flex-start',
      }}
    >
      <Box
      style={{
        width: '100%',
        maxWidth: 900,
        display: 'flex',
        justifyContent: mine ? 'flex-end' : 'flex-start',
      }}
    >
      <Box
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: mine ? 'flex-end' : 'flex-start',
          gap: 4,
          maxWidth: 640,
          minWidth: 0,
          flex: '0 1 auto',
          paddingLeft: !mine && hasAnyActions ? 8 : 0,
          paddingRight: mine && hasAnyActions ? 8 : 0,
        }}
      >
        {hasAnyActions && (
          <Box
            className="message-actions"
            style={{
              position: 'absolute',
              top: 4,
              right: mine ? -16 : 'auto',
              left: mine ? 'auto' : -16,
              zIndex: 3,
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <Menu position={mine ? 'bottom-end' : 'bottom-start'} withinPortal shadow="md" radius="md">
              <Menu.Target>
                <ActionIcon
                  aria-label="Message actions"
                  variant="filled"
                  size="sm"
                  radius="xl"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <MoreVertical size={16} />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                {hasAddToCalendar && (
                  <Menu.Item
                    leftSection={<CalendarPlus size={16} />}
                    onClick={() => onAddToCalendar?.(msg)}
                  >
                    Add to calendar
                  </Menu.Item>
                )}

                {hasReport && !mine && (
                  <Menu.Item
                    color="red"
                    leftSection={<ShieldAlert size={16} />}
                    onClick={() => onReport?.(msg)}
                  >
                    Report
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

        <Box
          style={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
          }}
        >
          <Tooltip label={ts} withinPortal>
            <Text
              role="text"
              aria-label={`Message sent ${ts}`}
              px="md"
              py={8}
              style={{
                ...bubbleStyle,
                position: 'relative',
                zIndex: 2,
                borderRadius: 18,
                borderBottomRightRadius: mine && showTail ? 8 : 18,
                borderBottomLeftRadius: !mine && showTail ? 8 : 18,
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                opacity: isTombstone ? 0.75 : 1,
                fontStyle: isTombstone ? 'italic' : 'normal',
                display: 'block',
                width: 'fit-content',
                maxWidth: '100%',
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

          {showTail && !isTombstone && (
            <Box
              aria-hidden="true"
              style={{
                position: 'absolute',
                bottom: 1,
                right: mine ? 3 : 'auto',
                left: mine ? 'auto' : 3,
                width: 12,
                height: 12,
                background: tailBg,
                transform: 'rotate(45deg)',
                borderRadius: mine ? '0 0 6px 0' : '0 0 0 6px',
                zIndex: 1,
              }}
            />
          )}
        </Box>

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
                  const imgSrc = a.thumbUrl || a.thumbnailUrl || url;
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
    </Box>
  </Box>
  );
}