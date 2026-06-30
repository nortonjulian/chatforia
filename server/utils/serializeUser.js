const FREE_THEMES = ['dawn', 'midnight'];

function hasPremiumAccess(user) {
  return ['PREMIUM', 'WIRELESS'].includes(
    String(user.plan || 'FREE').toUpperCase()
  );
}

export function serializeUser(user) {
  const premium = hasPremiumAccess(user);

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    publicKey: user.publicKey ?? null,
    plan: user.plan ?? 'FREE',
    role: user.role ?? 'USER',
    discoverability: user.discoverability ?? 'EVERYONE',
    isPremium: premium,

    preferredLanguage: user.preferredLanguage ?? 'en',
    uiLanguage: user.uiLanguage ?? user.preferredLanguage ?? 'en',

    theme:
      premium || FREE_THEMES.includes(user.theme)
        ? user.theme ?? 'dawn'
        : 'dawn',

    avatarUrl: user.avatarUrl ?? null,

    autoTranslate: user.autoTranslate ?? true,
    showOriginalWithTranslation: user.showOriginalWithTranslation ?? true,
    allowExplicitContent: user.allowExplicitContent ?? false,
    showReadReceipts: user.showReadReceipts ?? true,
    autoDeleteSeconds: user.autoDeleteSeconds ?? 0,

    privacyBlurEnabled: user.privacyBlurEnabled ?? false,
    privacyBlurOnUnfocus: user.privacyBlurOnUnfocus ?? false,
    privacyHoldToReveal: user.privacyHoldToReveal ?? false,
    notifyOnCopy: user.notifyOnCopy ?? false,

    ageBand: user.ageBand ?? null,
    wantsAgeFilter: user.wantsAgeFilter ?? true,
    randomChatAllowedBands: user.randomChatAllowedBands ?? [],
    riaRemember: user.riaRemember ?? true,

    voicemailEnabled: user.voicemailEnabled ?? true,
    voicemailAutoDeleteDays: user.voicemailAutoDeleteDays ?? null,
    voicemailForwardEmail: user.voicemailForwardEmail ?? null,
    voicemailGreetingText: user.voicemailGreetingText ?? null,
    voicemailGreetingUrl: user.voicemailGreetingUrl ?? null,

    messageTone: user.messageTone ?? 'Default.mp3',
    ringtone: user.ringtone ?? 'Classic.mp3',
    soundVolume: user.soundVolume ?? 70,

    enableSmartReplies: user.enableSmartReplies ?? false,
  };
}