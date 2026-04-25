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
    isPremium: premium,

    theme:
      premium || FREE_THEMES.includes(user.theme)
        ? user.theme ?? 'dawn'
        : 'dawn',
  };
}