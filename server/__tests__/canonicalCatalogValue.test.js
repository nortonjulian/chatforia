import { canonicalCatalogValue } from '../utils/canonicalCatalogValue.js';
import { premiumConfig } from '../config/premiumConfig.js';

describe('sound filename compatibility', () => {
  test('normalizes Android lowercase free-tone values to canonical filenames', () => {
    expect(canonicalCatalogValue('classic.mp3', premiumConfig.tones.freeRingtones))
      .toBe('Classic.mp3');
    expect(canonicalCatalogValue('urgency.mp3', premiumConfig.tones.freeRingtones))
      .toBe('Urgency.mp3');
    expect(canonicalCatalogValue('vibrate.mp3', premiumConfig.tones.freeMessageTones))
      .toBe('Vibrate.mp3');
  });

  test('preserves validation for unknown sounds', () => {
    expect(canonicalCatalogValue('not-in-the-catalog.mp3', premiumConfig.tones.freeRingtones))
      .toBeNull();
  });

  test('allows the existing Android Sparkle sound as Premium', () => {
    const name = canonicalCatalogValue('sparkle.mp3', premiumConfig.tones.premiumMessageTones);
    expect(name).toBe('sparkle.mp3');
  });

  test('does not downgrade premium tone classification', () => {
    const name = canonicalCatalogValue('bells.mp3', [
      ...premiumConfig.tones.freeRingtones,
      ...premiumConfig.tones.premiumRingtones,
    ]);
    expect(name).toBe('Bells.mp3');
    expect(premiumConfig.tones.premiumRingtones).toContain(name);
  });
});
