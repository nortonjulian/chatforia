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
    links: [
      { label: "Getting Started", href: "/guides/getting-started" }, // ← temporarily lives here
      { label: "Help Center", href: "/help" },
      { label: "Contact Us", href: "/contact" },
      { label: "Status Page", href: "https://status.chatforia.com", external: true },
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
    links: [
      { label: "iOS / App Store", href: "https://apps.apple.com/app/idXXXXXXXX", external: true },
      { label: "Android / Google Play", href: "https://play.google.com/store/apps/details?id=xxx", external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/legal/terms" },
      { label: "SMS Messaging Policy", href: "/legal/sms" },
      { label: "Do Not Sell My Info", href: "/legal/do-not-sell" },
      { label: "Cookie Settings", href: "/legal/cookies" },
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
