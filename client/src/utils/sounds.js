// Uses localStorage and Vite env (import.meta.env). No external imports.

/* =========================
 * LocalStorage keys
 * =======================*/
const LS_KEYS = {
  messageTone: 'sound:messageTone',
  ringtone: 'sound:ringtone',
  volume: 'sound:volume', // 0..1
};

/* =========================
 * Master catalogs
 * (filenames must exist in /public/sounds/...)
 * Each option is { label, value }
 * =======================*/
export const ALL_MESSAGE_TONES = [
  { label: 'Default',            value: 'Default.mp3' },
  { label: 'Dreamer',            value: 'Dreamer.mp3' },
  { label: 'Happy Message',      value: 'Happy Message.mp3' },
  { label: 'Notify',             value: 'Notify.mp3' },
  { label: 'Pop',                value: 'Pop.mp3' },
  { label: 'Pulsating Sound',    value: 'Pulsating Sound.mp3' },
  { label: 'Text Message',       value: 'Text Message.mp3' },
  { label: 'Vibrate',            value: 'Vibrate.mp3' },
  { label: 'Xylophone',          value: 'Xylophone.mp3' },
];

export const ALL_RINGTONES = [
  { label: 'Bells',          value: 'Bells.mp3' },
  { label: 'Classic',        value: 'Classic.mp3' },
  { label: 'Chimes',         value: 'Chimes.mp3' },
  { label: 'Digital Phone',  value: 'Digital Phone.mp3' },
  { label: 'Melodic',        value: 'Melodic.mp3' },
  { label: 'Organ Notes',    value: 'Organ Notes.mp3' },
  { label: 'Sound Reality',  value: 'Sound Reality.mp3' },
  { label: 'Street',         value: 'Street.mp3' },
  { label: 'Universfield',   value: 'Universfield.mp3' }, // ✱ verify this exact filename exists
  { label: 'Urgency',        value: 'Urgency.mp3' },
];

/* =========================
 * Free-plan selections (exactly 2 + 2)
 * =======================*/
const FREE_MESSAGE = ['Default.mp3', 'Vibrate.mp3'];
const FREE_RING    = ['Classic.mp3', 'Urgency.mp3'];

/* =========================
 * Defaults
 * =======================*/
export const DEFAULTS = {
  messageTone: 'Default.mp3',
  ringtone: 'Classic.mp3',
  volume: 0.7,
};

/* =========================
 * Helpers
 * =======================*/
const valueSet = (arr) => new Set(arr.map((x) => x.value));
const MESSAGE_VALUES = valueSet(ALL_MESSAGE_TONES);
const RING_VALUES    = valueSet(ALL_RINGTONES);

const coerceToKnown = (val, knownSet, fallback) =>
  knownSet.has(val) ? val : fallback;

export const findMessageToneOption = (filename) =>
  ALL_MESSAGE_TONES.find((o) => o.value === filename) || null;

export const findRingtoneOption = (filename) =>
  ALL_RINGTONES.find((o) => o.value === filename) || null;

/* =========================
 * Plan-aware listings
 * =======================*/
export function listMessageTones(plan = 'FREE') {
  const p = String(plan || 'FREE').toUpperCase();
  return p === 'PREMIUM'
    ? ALL_MESSAGE_TONES
    : ALL_MESSAGE_TONES.filter((x) => FREE_MESSAGE.includes(x.value));
}

export function listRingtones(plan = 'FREE') {
  const p = String(plan || 'FREE').toUpperCase();
  return p === 'PREMIUM'
    ? ALL_RINGTONES
    : ALL_RINGTONES.filter((x) => FREE_RING.includes(x.value));
}

/* =========================
 * Local preference getters/setters
 * (always store filenames)
 * =======================*/
export function getMessageTone() {
  const raw = localStorage.getItem(LS_KEYS.messageTone);
  return coerceToKnown(raw, MESSAGE_VALUES, DEFAULTS.messageTone);
}
export function setMessageTone(filename) {
  const val = coerceToKnown(filename, MESSAGE_VALUES, DEFAULTS.messageTone);
  localStorage.setItem(LS_KEYS.messageTone, val);
}

export function getRingtone() {
  const raw = localStorage.getItem(LS_KEYS.ringtone);
  return coerceToKnown(raw, RING_VALUES, DEFAULTS.ringtone);
}
export function setRingtone(filename) {
  const val = coerceToKnown(filename, RING_VALUES, DEFAULTS.ringtone);
  localStorage.setItem(LS_KEYS.ringtone, val);
}

export function getVolume() {
  const v = parseFloat(localStorage.getItem(LS_KEYS.volume));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULTS.volume;
}
export function setVolume(v) {
  const val = Math.min(1, Math.max(0, Number(v)));
  localStorage.setItem(LS_KEYS.volume, String(val));
}

/* =========================
 * URL resolvers (served by Vite from /public)
 * =======================*/
export function messageToneUrl(filename = getMessageTone()) {
  return `/sounds/Message_Tones/${filename}`;
}
export function ringtoneUrl(filename = getRingtone()) {
  return `/sounds/Ringtones/${filename}`;
}

/* =========================
 * Premium config (derived from catalogs to avoid drift)
 * For client builds with Vite, use import.meta.env
 * =======================*/
export const premiumConfig = {
  // Device limits
  FREE_DEVICE_LIMIT: Number(import.meta.env.VITE_FREE_DEVICE_LIMIT ?? 2),
  PREMIUM_DEVICE_LIMIT: Number(import.meta.env.VITE_PREMIUM_DEVICE_LIMIT ?? 5),

  // Disappearing message caps (in days)
  FREE_EXPIRE_MAX_DAYS: Number(import.meta.env.VITE_FREE_EXPIRE_MAX_DAYS ?? 1),
  PREMIUM_EXPIRE_MAX_DAYS: Number(import.meta.env.VITE_PREMIUM_EXPIRE_MAX_DAYS ?? 30),

  // Tone & theme catalogs (filenames)
  tones: {
    freeRingtones: FREE_RING,
    premiumRingtones: ALL_RINGTONES.map((x) => x.value).filter((v) => !FREE_RING.includes(v)),
    freeMessageTones: FREE_MESSAGE,
    premiumMessageTones: ALL_MESSAGE_TONES.map((x) => x.value).filter((v) => !FREE_MESSAGE.includes(v)),
  },
};
