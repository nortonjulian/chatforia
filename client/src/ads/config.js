export const ADS_CONFIG = {
  house: {
    default: [
      {
        kind: 'card',
        titleKey: 'upgrade.goPremium',
        title: 'Go Premium',
        bodyKey: 'upgrade.benefitsLine',
        body: 'Unlock power features & remove ads.',
        ctaKey: 'upgrade.cta',
        cta: 'Upgrade',
        href: '/settings/upgrade',
      },
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
    upgrade: [
      {
        kind: 'card',
        titleKey: 'upgrade.goPremium',
        title: 'Premium for power users',
        bodyKey: 'upgrade.benefitsLine',
        body: 'Advanced tools, no ads.',
        ctaKey: 'upgrade.cta',
        cta: 'Upgrade',
        href: '/settings/upgrade',
      },
    ],
  },
};
