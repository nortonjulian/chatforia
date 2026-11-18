import Boom from '@hapi/boom';

// Temporary launch rule. Removing or relaxing this rule requires a reviewed
// product/security change; there is deliberately no date-based expiry.
export const TEEN_VISUAL_MEDIA_CODE = 'TEEN_VISUAL_MEDIA_RESTRICTED';

export const isTeenAccount = (user) => user?.ageBand === 'TEEN_13_17';

const VISUAL_KINDS = new Set(['IMAGE', 'VIDEO', 'GIF']);
const VISUAL_EXTENSIONS = /\.(?:jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?|mp4|m4v|mov|webm|ogv|3gp|3g2)(?:[?#]|$)/i;
const AUDIO_EXTENSIONS = /\.(?:m4a|mp3|wav|aac|ogg|opus|flac)(?:[?#]|$)/i;

export function isVisualAttachment(attachment) {
  if (!attachment) return false;
  const kind = String(attachment.kind || '').toUpperCase();
  const mime = String(attachment.mimeType || attachment.contentType || attachment.mimetype || '').toLowerCase();
  const reference = String(attachment.url || attachment.originalname || attachment.filename || '');
  // A thumbnail is itself a visual object, even if the enclosing item was
  // mislabeled as a generic file by an older client.
  const isAudio = kind === 'AUDIO' || mime.startsWith('audio/') || AUDIO_EXTENSIONS.test(reference);
  const hasThumbnail = !isAudio && Boolean(attachment.thumbUrl || attachment.thumbnailUrl || attachment.previewUrl);
  // WebM is a container used for voice notes as well as video. A stored
  // audio MIME type is stronger evidence than its ambiguous extension.
  if (mime.startsWith('audio/') && !VISUAL_KINDS.has(kind)) return false;
  return VISUAL_KINDS.has(kind) || mime.startsWith('image/') ||
    mime.startsWith('video/') || hasThumbnail || VISUAL_EXTENSIONS.test(reference);
}

export function redactVisualMedia(message, { viewerTeen = false, senderTeen = false } = {}) {
  if (!message || (!viewerTeen && !senderTeen)) return message;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const visible = attachments.filter((item) => !isVisualAttachment(item));
  const hidden = visible.length !== attachments.length || Boolean(message.imageUrl);
  if (!hidden) return message;
  return {
    ...message,
    attachments: visible,
    imageUrl: null,
    mediaRestricted: true,
  };
}

export function redactVisualMediaForViewer(message, viewerTeen, roomTeen = false) {
  if (!message) return message;
  const { ageBand, ...sender } = message.sender || {};
  const shaped = redactVisualMedia(
    { ...message, sender },
    { viewerTeen: viewerTeen || roomTeen, senderTeen: ageBand === 'TEEN_13_17' },
  );
  return { ...shaped, mediaRestricted: shaped.mediaRestricted === true };
}

export async function roomHasTeen(db, chatRoomId) {
  const participant = await db.participant.findFirst({
    where: {
      chatRoomId: Number(chatRoomId),
      user: { ageBand: 'TEEN_13_17' },
    },
    select: { id: true },
  });
  return Boolean(participant);
}

export function visualMediaRestrictionError() {
  const error = Boom.forbidden('Image and video attachments are unavailable in conversations involving teen accounts.');
  error.code = TEEN_VISUAL_MEDIA_CODE;
  error.output.payload.code = TEEN_VISUAL_MEDIA_CODE;
  return error;
}

// Carrier MMS metadata is supplied by a provider, while older outbound rows
// store only a key. Unknown item types are withheld for teens because they
// cannot safely be distinguished from image/video media without fetching them.
export function isTeenMmsRestricted(item) {
  if (!item) return false;
  if (typeof item === 'string') return true;
  const mime = String(item.contentType || item.mimeType || '').toLowerCase();
  return !mime || isVisualAttachment(item);
}

export function redactTeenSmsMedia(message, viewerTeen) {
  if (!message || !viewerTeen) return message;
  const original = Array.isArray(message.mediaUrls) ? message.mediaUrls :
    message.mediaUrls && typeof message.mediaUrls === 'object' ? Object.values(message.mediaUrls) : [];
  const visible = original.filter((item) => !isTeenMmsRestricted(item));
  return { ...message, mediaUrls: visible, mediaRestricted: visible.length !== original.length };
}
