export const ADS_CONFIG = {
  house: {
    empty_state_promo: [
      {
        kind: 'card',
        title: 'Start a chat',
        body: 'Invite a friend and try Smart Replies.',
        cta: 'New chat',
        href: '/new',
      },
    ],
    thread_inline_1: [
      {
        kind: 'card',
        title: 'Go Premium',
        body: 'Remove ads and unlock extra features.',
        cta: 'Upgrade',
        href: '/settings/upgrade',
      },
    ],
    // chat_footer: [
    //   {
    //     kind: 'image',
    //     img: '/house/upgrade-banner.png', // put a real asset here
    //     href: '/settings/upgrade',
    //   },
    // ],
    inbox_native_1: [
      {
        kind: 'card',
        title: 'Try Premium free',
        body: 'Priority support and extra tools.',
        cta: 'Start trial',
        href: '/settings/upgrade',
      },
    ],

    // config.js
    chat_footer: [
      {
        kind: 'card',
        title: 'Go Premium',
        body: 'Remove ads and unlock extra features.',
        cta: 'Upgrade',
        href: '/settings/upgrade',
      },
    ],

    // Optional: generic default fallback
    default: [
      {
        kind: 'card',
        title: 'Upgrade to Premium',
        body: 'Ad-free experience.',
        cta: 'Upgrade',
        href: '/settings/upgrade',
      },
    ],
  },
};


