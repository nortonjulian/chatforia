export const ADS_CONFIG = {
  house: {
    /* --------------------------------------------------
     * Fallback (used if placement key is missing)
     * -------------------------------------------------- */
    default: [
      {
        kind: 'native',
        titleKey: 'premium.heading',
        title: 'Go Premium',
        bodyKey: 'premium.description',
        body: 'Unlock power features & remove ads.',
        ctaKey: 'premium.upgrade',
        cta: 'Upgrade',
        href: '/settings/upgrade',
      },
    ],

    /* --------------------------------------------------
     * Empty state (no chat selected)
     * -------------------------------------------------- */
    empty_state_promo: [
      {
        kind: 'native',
        title: 'Start your first chat',
        body: 'Invite a friend or try Random Chat!',
        cta: 'New Chat',
        href: '/new-chat',
      },
    ],

    /* --------------------------------------------------
     * Footer (above composer)
     * -------------------------------------------------- */
    chat_footer: [
      {
        kind: 'native',
        title: 'Boost your chat experience',
        body: 'Upgrade to remove ads.',
        cta: 'Upgrade',
        href: '/settings/upgrade',
      },
    ],

    /* --------------------------------------------------
     * Inline message-list card
     * -------------------------------------------------- */
    thread_inline_1: [
      {
        kind: 'native',
        title: 'Smart replies + translate',
        body: 'Try Premium features.',
        cta: 'Learn more',
        href: '/settings/upgrade',
      },
    ],

    /* --------------------------------------------------
     * Top-of-thread promo
     * -------------------------------------------------- */
    thread_top: [
      {
        kind: 'native',
        title: 'Go Premium',
        body: 'Unlock power features & remove ads.',
        cta: 'Upgrade',
        href: '/settings/upgrade',
      },
    ],

    /* --------------------------------------------------
     * Upgrade page / settings surfaces
     * -------------------------------------------------- */
    upgrade: [
      {
        kind: 'native',
        titleKey: 'premium.heading',
        title: 'Premium for power users',
        bodyKey: 'premium.description',
        body: 'Advanced tools, no ads.',
        ctaKey: 'premium.upgrade',
        cta: 'Upgrade',
        href: '/settings/upgrade',
      },
    ],
  },
};

export default ADS_CONFIG;
