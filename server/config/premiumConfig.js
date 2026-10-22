export const premiumConfig = {
  // Device limits
  FREE_DEVICE_LIMIT: Number(process.env.FREE_DEVICE_LIMIT || 2),
  PREMIUM_DEVICE_LIMIT: Number(process.env.PREMIUM_DEVICE_LIMIT || 5),

  // Disappearing message caps (days)
  FREE_EXPIRE_MAX_DAYS: Number(process.env.FREE_EXPIRE_MAX_DAYS || 1),
  PREMIUM_EXPIRE_MAX_DAYS: Number(process.env.PREMIUM_EXPIRE_MAX_DAYS || 30),

  // Tone & theme catalogs
  tones: {
    // Full catalogs (filenames are fine)
    allRingtones: [
      'Bells.mp3',
      'Classic.mp3',
      'Chimes.mp3',
      'Digital Phone.mp3',
      'Melodic.mp3',
      'Organ Notes.mp3',
      'Sound Reality.mp3',
      'Street.mp3',
      'Universfield.mp3', // ensure this file exists or rename
      'Urgency.mp3',
    ],
    allMessageTones: [
      'Default.mp3',
      'Dreamer.mp3',
      'Happy Message.mp3',
      'Notify.mp3',
      'Pop.mp3',
      'Pulsating Sound.mp3',
      'sparkle.mp3',
      'Text Message.mp3',
      'Vibrate.mp3',
      'Xylophone.mp3',
    ],

    // Free subsets (exactly 2 + 2 per your UI)
    freeRingtones: ['Classic.mp3', 'Urgency.mp3'],
    freeMessageTones: ['Default.mp3', 'Vibrate.mp3'],

    // ✅ Premium subsets (everything not free, plus explicit premium-only ids)
    premiumRingtones: [
      'Bells.mp3',
      'Chimes.mp3',
      'Digital Phone.mp3',
      'Melodic.mp3',
      'Organ Notes.mp3',
      'Sound Reality.mp3',
      'Street.mp3',
      'Universfield.mp3',
    ].filter((id, i, arr) => arr.indexOf(id) === i), // de-dupe safety

    premiumMessageTones: [
      'starlight-tap',
      'quasar-tick',
      'Dreamer.mp3',
      'Happy Message.mp3',
      'Notify.mp3',
      'Pop.mp3',
      'Pulsating Sound.mp3',
      'sparkle.mp3',
      'Text Message.mp3',
      'Xylophone.mp3',
    ].filter((id, i, arr) => arr.indexOf(id) === i),
  },
};
