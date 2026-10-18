// Presentation only: retain the encrypted message marker and genuine user captions.
export function voiceNotePreview(value, t) {
  if (/^\[(?:voice note|audio)\]$/i.test(String(value || '').trim())) {
    return t('messages.voiceNoteLabel', 'Voice note');
  }
  return value;
}
