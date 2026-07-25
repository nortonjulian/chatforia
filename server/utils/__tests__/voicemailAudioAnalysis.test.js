import {
  analyzeAudioChannels,
  isEffectivelySilentVoicemail,
} from '../voicemailAudioAnalysis.js';

describe('voicemailAudioAnalysis', () => {
  test('classifies near-digital silence as empty', () => {
    const samples = new Float32Array(5000);

    samples.fill(0.00046);
    samples[2500] = 0.00194;

    const analysis = analyzeAudioChannels({
      channels: [samples],
      sampleRate: 1000,
    });

    expect(analysis.durationSec).toBe(5);
    expect(analysis.peakDbfs).toBeLessThan(-50);
    expect(analysis.rmsDbfs).toBeLessThan(-60);
    expect(analysis.activePercent).toBe(0);

    expect(
      isEffectivelySilentVoicemail(analysis)
    ).toBe(true);
  });

  test('preserves a short recording containing speech-level audio', () => {
    const samples = new Float32Array(5000);

    for (let index = 0; index < 1000; index += 1) {
      samples[index] =
        index % 2 === 0
          ? 0.02
          : -0.02;
    }

    const analysis = analyzeAudioChannels({
      channels: [samples],
      sampleRate: 1000,
    });

    expect(analysis.durationSec).toBe(5);
    expect(analysis.activePercent).toBeGreaterThan(0);

    expect(
      isEffectivelySilentVoicemail(analysis)
    ).toBe(false);
  });

  test('ignores an isolated transient with no sustained audio', () => {
    const samples = new Float32Array(5000);

    samples[2500] = 0.02;

    const analysis = analyzeAudioChannels({
      channels: [samples],
      sampleRate: 1000,
    });

    expect(analysis.peakDbfs).toBeGreaterThan(-50);
    expect(analysis.rmsDbfs).toBeLessThan(-60);
    expect(analysis.activePercent).toBe(0);

    expect(
      isEffectivelySilentVoicemail(analysis)
    ).toBe(true);
  });
});
