const PLAN_LEVEL = Object.freeze({
  FREE: 0,
  PLUS: 1,
  PREMIUM: 2,

  // Wireless currently receives paid application entitlements.
  WIRELESS: 2,
});

export const MESSAGE_TONE_CATALOG = Object.freeze({
  'Default.mp3': Object.freeze({
    apnsSound: 'Chatforia_Default.caf',
    requiredPlan: 'FREE',
  }),

  'Vibrate.mp3': Object.freeze({
    apnsSound: 'Chatforia_Vibrate.caf',
    requiredPlan: 'FREE',
  }),

  'Dreamer.mp3': Object.freeze({
    apnsSound: 'Chatforia_Dreamer.caf',
    requiredPlan: 'PREMIUM',
  }),

  'Happy Message.mp3': Object.freeze({
    apnsSound: 'Chatforia_HappyMessage.caf',
    requiredPlan: 'PREMIUM',
  }),

  'Notify.mp3': Object.freeze({
    apnsSound: 'Chatforia_Notify.caf',
    requiredPlan: 'PREMIUM',
  }),

  'Pop.mp3': Object.freeze({
    apnsSound: 'Chatforia_Pop.caf',
    requiredPlan: 'PREMIUM',
  }),

  'Pulsating Sound.mp3': Object.freeze({
    apnsSound: 'Chatforia_PulsatingSound.caf',
    requiredPlan: 'PREMIUM',
  }),

  'Text Message.mp3': Object.freeze({
    apnsSound: 'Chatforia_TextMessage.caf',
    requiredPlan: 'PREMIUM',
  }),

  'Xylophone.mp3': Object.freeze({
    apnsSound: 'Chatforia_Xylophone.caf',
    requiredPlan: 'PREMIUM',
  }),
});

const DEFAULT_TONE = MESSAGE_TONE_CATALOG['Default.mp3'];

function normalizedPlanLevel(plan) {
  const normalized = String(plan || 'FREE')
    .trim()
    .toUpperCase();

  return PLAN_LEVEL[normalized] ?? PLAN_LEVEL.FREE;
}

export function resolveMessageNotificationSound({
  messageTone,
  plan,
} = {}) {
  const selected =
    MESSAGE_TONE_CATALOG[messageTone] ||
    DEFAULT_TONE;

  const requiredLevel =
    PLAN_LEVEL[selected.requiredPlan] ??
    PLAN_LEVEL.FREE;

  if (normalizedPlanLevel(plan) < requiredLevel) {
    return DEFAULT_TONE.apnsSound;
  }

  return selected.apnsSound;
}
