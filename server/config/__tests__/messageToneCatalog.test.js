import {
  resolveMessageNotificationSound,
} from '../messageToneCatalog.js';

describe('resolveMessageNotificationSound', () => {
  test('returns the Free default sound', () => {
    expect(
      resolveMessageNotificationSound({
        messageTone: 'Default.mp3',
        plan: 'FREE',
      })
    ).toBe('Chatforia_Default.caf');
  });

  test('returns the silent APNs sound for Vibrate', () => {
    expect(
      resolveMessageNotificationSound({
        messageTone: 'Vibrate.mp3',
        plan: 'FREE',
      })
    ).toBe('Chatforia_Vibrate.caf');
  });

  test('returns a selected Premium sound for Premium', () => {
    expect(
      resolveMessageNotificationSound({
        messageTone: 'Dreamer.mp3',
        plan: 'PREMIUM',
      })
    ).toBe('Chatforia_Dreamer.caf');
  });

  test('prevents Free from receiving a Premium sound', () => {
    expect(
      resolveMessageNotificationSound({
        messageTone: 'Dreamer.mp3',
        plan: 'FREE',
      })
    ).toBe('Chatforia_Default.caf');
  });

  test('prevents Plus from receiving a Premium sound', () => {
    expect(
      resolveMessageNotificationSound({
        messageTone: 'Dreamer.mp3',
        plan: 'PLUS',
      })
    ).toBe('Chatforia_Default.caf');
  });

  test('falls back for an unknown or retired tone', () => {
    expect(
      resolveMessageNotificationSound({
        messageTone: 'Retired Tone.mp3',
        plan: 'PREMIUM',
      })
    ).toBe('Chatforia_Default.caf');
  });

  test('supports Wireless paid entitlements', () => {
    expect(
      resolveMessageNotificationSound({
        messageTone: 'Notify.mp3',
        plan: 'WIRELESS',
      })
    ).toBe('Chatforia_Notify.caf');
  });
});
