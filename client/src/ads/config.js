export const ADS_CONFIG = {
  house: {
    default: [
      { kind: 'card', title: 'Go Premium', body: 'Unlock power features & remove ads.', cta: 'Upgrade', href: '/settings/upgrade' },
    ],
    empty_state_promo: [
      { kind: 'card', title: 'Start your first chat', body: 'Invite a friend or try Random Chat!', cta: 'New Chat', href: '/new-chat' },
    ],
    chat_footer: [
      { kind: 'card', title: 'Boost your chat experience', body: 'Upgrade to remove ads.', cta: 'Upgrade', href: '/settings/upgrade' },
    ],
    thread_inline_1: [
      { kind: 'card', title: 'Smart replies + translate', body: 'Try Premium features.', cta: 'Learn more', href: '/settings/upgrade' },
    ],
    // optional if you used type="upgrade" anywhere:
    upgrade: [
      { kind: 'card', title: 'Premium for power users', body: 'Advanced tools, no ads.', cta: 'Upgrade', href: '/settings/upgrade' },
    ],
  },
};
