export const FOOTER_SECTIONS = [
  {
    title: 'Company',
    i18nKey: 'company',
    links: [
      {
        label: 'Plans & Pricing',
        href: '/pricing',            // 👈 important: goes to pricing page
        i18nKey: 'plans-pricing',
      },
      {
        label: 'About Chatforia',
        href: '/about',
        i18nKey: 'about-chatforia',
      },
      { label: 'How It Works', 
        href: '/how-it-works',
        i18nKey: 'how-it-works',
      },
      { label: 'Blog', 
        href: '/blog',
        i18nKey: 'blog',
      },
      {
        label: 'Careers',
        href: '/careers',
        i18nKey: 'careers',
      },
      {
        label: 'Press',
        href: '/press',
        i18nKey: 'press',
      },
      {
        label: 'Advertise',
        href: '/advertise',
        i18nKey: 'advertise',
      },
    ],
  },
  {
  title: "Support",
  i18nKey: "support",
  links: [
    {
      label: "Getting Started",
      href: "/guides/getting-started",
      i18nKey: "getting-started",
    },
    {
      label: "Help Center",
      href: "/help",
      i18nKey: "help-center",
    },
    {
      label: "Safety",
      href: "/safety",
      i18nKey: "safety",
    },
    {
      label: "Contact Us",
      href: "/contact",
      i18nKey: "contact-us",
    },
    {
      label: "Status Page",
      href: "https://status.chatforia.com",
      external: true,
      i18nKey: "status-page",
    },
  ],
},

  // --- Resources (parked for launch) -----------------------------------------
  // When you have at least 2 items, uncomment this block and consider
  // moving "Getting Started" back here.
  //
  // {
  //   title: "Resources",
  //   links: [
  //     { label: "Getting Started", href: "/guides/getting-started" },
  //     // Later:
  //     // { label: "User Guides", href: "/guides" },
  //     // { label: "Tips & Tutorials", href: "/tips" },
  //     // { label: "Blog", href: "/blog" },
  //   ],
  // },

  {
  title: "Downloads",
  i18nKey: "downloads",
  links: [
    {
      label: "iOS / App Store",
      href: "https://apps.apple.com/us/app/chatforia/id6761696765",
      external: true,
      i18nKey: "ios-app-store",
    },
    {
      label: "Android / Google Play",
      href: "https://play.google.com/store/apps/details?id=com.chatforia.android",
      external: true,
      i18nKey: "android-google-play",
    },
  ],
},
  {
  title: "Legal",
  i18nKey: "legal",
  links: [
    {
      label: "Privacy Policy",
      href: "/privacy",
      i18nKey: "privacy-policy",
    },
    {
      label: "Terms of Service",
      href: "/legal/terms",
      i18nKey: "terms-of-service",
    },
    {
      label: "Refund Policy",
      href: "/refund-policy",
      i18nKey: "refund-policy",
    },
    {
      label: "SMS Messaging Policy",
      href: "/legal/sms",
      i18nKey: "sms-messaging-policy",
    },
    {
      label: "Open Source Licenses",
      href: "/legal/open-source",
      i18nKey: "open-source-licenses",
    },
    {
      label: "Do Not Sell My Info",
      href: "/legal/do-not-sell",
      i18nKey: "do-not-sell-my-info",
    },
    {
      label: "Cookie Settings",
      href: "/legal/cookies",
      i18nKey: "cookie-settings",
    },
  ],
 },
];

export const SOCIALS = [
  { name: "TikTok", href: "https://tiktok.com/@chatforia", icon: "tiktok" },
  { name: "Instagram", href: "https://instagram.com/chatforia", icon: "instagram" },
  { name: "Facebook", href: "https://facebook.com/chatforia", icon: "facebook" },
  { name: "LinkedIn", href: "https://linkedin.com/company/chatforia", icon: "linkedin" },
  { name: "X (Twitter)", href: "https://x.com/chatforia", icon: "x" },
];

export const COPYRIGHT_TEXT = `© ${new Date().getFullYear()} Chatforia Inc. All rights reserved.`;
