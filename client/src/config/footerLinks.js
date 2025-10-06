// Everything here is easy to edit without touching layout code.

export const FOOTER_SECTIONS = [
  {
    title: "Company",
    links: [
      { label: "About Chatforia", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Press", href: "/press" },
      { label: "Advertise", href: "/advertise" },
      // add “Investors” if you ever want it
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Help Center", href: "/help" },
      { label: "Contact Us", href: "/contact" },
      { label: "Status Page", href: "https://status.chatforia.com", external: true },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "User Guides", href: "/guides" },
      { label: "Tips & Tutorials", href: "/tips" },
      // add “API Docs” later if you ship one
    ],
  },
  {
    // We’ll render downloads with badges component, but keep a stub for consistency
    title: "Downloads",
    links: [
      { label: "iOS / App Store", href: "https://apps.apple.com/app/idXXXXXXXX", external: true },
      { label: "Android / Google Play", href: "https://play.google.com/store/apps/details?id=xxx", external: true },
      // { label: "Desktop", href: "/download" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Do Not Sell My Info", href: "/privacy/dnsmi" },
      { label: "Cookie Settings", href: "/cookies" },
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
