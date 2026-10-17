import { serializeUser } from '../serializeUser.js';

describe('serializeUser accessibility preferences', () => {
  test('preserves accessibility preferences', () => {
    const user = {
      id: 1,
      email: 'test@example.com',
      username: 'testuser',
      plan: 'FREE',
      role: 'USER',

      a11yUiFont: 'lg',
      a11yVisualAlerts: true,
      a11yLiveCaptions: false,
      a11yVoiceNoteSTT: true,
      a11yCaptionFont: 'sm',
      a11yCaptionBg: 'transparent',
    };

    expect(serializeUser(user)).toMatchObject({
      a11yUiFont: 'lg',
      a11yVisualAlerts: true,
      a11yLiveCaptions: false,
      a11yVoiceNoteSTT: true,
      a11yCaptionFont: 'sm',
      a11yCaptionBg: 'transparent',
    });
  });

  test('uses schema-compatible defaults when accessibility preferences are absent', () => {
    const serialized = serializeUser({
      id: 1,
      email: 'test@example.com',
      username: 'testuser',
      plan: 'FREE',
      role: 'USER',
    });

    expect(serialized).toMatchObject({
      a11yUiFont: 'md',
      a11yVisualAlerts: false,
      a11yLiveCaptions: false,
      a11yVoiceNoteSTT: false,
      a11yCaptionFont: 'lg',
      a11yCaptionBg: 'dark',
    });
  });
});
