export const a11yConfig = {
  PREMIUM_STT_MIN_PER_MONTH: 120, // Proposed launch allowance, separate from voicemail.
  FREE_STT_MIN_PER_MONTH: Number(process.env.FREE_STT_MIN_PER_MONTH || 20), // minutes for Free
  FREE_CAPTIONS_MIN_PER_MONTH: Number(process.env.FREE_CAPTIONS_MIN_PER_MONTH || 0),
  // Languages that are free; others require Premium
  FREE_STT_LANGS: (process.env.FREE_STT_LANGS || 'en-US').split(',')
};
