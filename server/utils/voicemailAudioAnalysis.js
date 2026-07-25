import decode from 'audio-decode';
import { fetchTwilioMedia } from './twilioMediaProxy.js';

const FRAME_DURATION_MS = 20;
const ACTIVE_FRAME_DBFS = -45;
const SILENT_RMS_DBFS = -60;
const MAX_ACTIVE_PERCENT = 0.5;

function amplitudeToDbfs(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return 20 * Math.log10(value);
}

function decodedChannels(audio) {
  if (
    Array.isArray(audio?.channelData) &&
    audio.channelData.length > 0
  ) {
    return audio.channelData;
  }

  if (
    audio?.channelData &&
    ArrayBuffer.isView(audio.channelData)
  ) {
    return [audio.channelData];
  }

  if (
    typeof audio?.getChannelData === 'function' &&
    Number.isInteger(audio.numberOfChannels) &&
    audio.numberOfChannels > 0
  ) {
    return Array.from(
      { length: audio.numberOfChannels },
      (_, index) => audio.getChannelData(index)
    );
  }

  if (Array.isArray(audio) && audio.length > 0) {
    return audio;
  }

  throw new Error('Unsupported decoded audio structure');
}

export function analyzeAudioChannels({
  channels,
  sampleRate,
}) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('Audio has no channels');
  }

  const numericSampleRate = Number(sampleRate);

  if (
    !Number.isFinite(numericSampleRate) ||
    numericSampleRate <= 0
  ) {
    throw new Error(`Invalid audio sample rate: ${sampleRate}`);
  }

  const frameCount = Math.max(
    ...channels.map((channel) => channel.length)
  );

  if (frameCount <= 0) {
    throw new Error('Audio has no samples');
  }

  let peak = 0;
  let sumSquares = 0;
  let sampleCount = 0;

  for (const channel of channels) {
    for (const rawSample of channel) {
      const sample = Number(rawSample);

      if (!Number.isFinite(sample)) {
        continue;
      }

      const absolute = Math.abs(sample);

      if (absolute > peak) {
        peak = absolute;
      }

      sumSquares += sample * sample;
      sampleCount += 1;
    }
  }

  const rms =
    sampleCount > 0
      ? Math.sqrt(sumSquares / sampleCount)
      : 0;

  const samplesPerFrame = Math.max(
    1,
    Math.round(
      numericSampleRate *
        (FRAME_DURATION_MS / 1000)
    )
  );

  const activeThreshold =
    Math.pow(10, ACTIVE_FRAME_DBFS / 20);

  let activeFrames = 0;
  let totalFrames = 0;

  for (
    let start = 0;
    start < frameCount;
    start += samplesPerFrame
  ) {
    const end = Math.min(
      start + samplesPerFrame,
      frameCount
    );

    let frameSumSquares = 0;
    let frameSampleCount = 0;

    for (const channel of channels) {
      const channelEnd = Math.min(
        end,
        channel.length
      );

      for (
        let index = start;
        index < channelEnd;
        index += 1
      ) {
        const sample = Number(channel[index]);

        if (!Number.isFinite(sample)) {
          continue;
        }

        frameSumSquares += sample * sample;
        frameSampleCount += 1;
      }
    }

    const frameRms =
      frameSampleCount > 0
        ? Math.sqrt(
            frameSumSquares / frameSampleCount
          )
        : 0;

    totalFrames += 1;

    if (frameRms >= activeThreshold) {
      activeFrames += 1;
    }
  }

  const activePercent =
    totalFrames > 0
      ? (activeFrames / totalFrames) * 100
      : 0;

  return {
    durationSec: frameCount / numericSampleRate,
    channelCount: channels.length,
    sampleRate: numericSampleRate,
    peak,
    peakDbfs: amplitudeToDbfs(peak),
    rms,
    rmsDbfs: amplitudeToDbfs(rms),
    activeFrames,
    totalFrames,
    activePercent,
  };
}

export function isEffectivelySilentVoicemail(
  analysis
) {
  return (
    analysis.rmsDbfs <= SILENT_RMS_DBFS &&
    analysis.activePercent <= MAX_ACTIVE_PERCENT
  );
}

export async function analyzeTwilioVoicemailAudio(
  audioUrl
) {
  const response = await fetchTwilioMedia(audioUrl);
  const encoded = Buffer.from(
    await response.arrayBuffer()
  );

  if (encoded.length === 0) {
    throw new Error('Twilio recording is empty');
  }

  const decoded = await decode(encoded);
  const channels = decodedChannels(decoded);

  return analyzeAudioChannels({
    channels,
    sampleRate: decoded.sampleRate,
  });
}
