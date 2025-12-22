/**
 * @typedef {'chat'|'sms'} ThreadKind
 * @typedef {'image'|'video'|'audio'|'file'} MediaKind
 *
 * @typedef {Object} ThreadLast
 * @property {string=} text
 * @property {(string|number)=} messageId
 * @property {string=} at
 * @property {boolean=} hasMedia
 * @property {number=} mediaCount
 * @property {MediaKind[]=} mediaKinds
 * @property {(string|null)=} thumbUrl
 *
 * @typedef {Object} Thread
 * @property {ThreadKind} kind
 * @property {string|number} id
 * @property {string} title
 * @property {(string|null)=} updatedAt
 * @property {boolean=} isGroup
 * @property {number=} unreadCount
 * @property {ThreadLast=} last
 * @property {(string|null)=} avatarUrl
 * @property {(string|null)=} phone
 */
export {};
