export const PLACEMENTS = {
  SIDEBAR_PRIMARY: 'sidebar_primary',
  THREAD_INLINE_1: 'thread_inline_1',
  CHAT_FOOTER: 'chat_footer',
  // new
  INBOX_NATIVE_1: 'inbox_native_1',
  CONTACTS_TOP_BANNER: 'contacts_top_banner',
  CONTACTS_INLINE_1: 'contacts_inline_1',
  START_CHAT_MODAL_FOOTER: 'start_chat_modal_footer',
  SEARCH_RESULTS_FOOTER: 'search_results_footer',
  SIDEBAR_SECONDARY: 'sidebar_secondary',
  DISCOVER_TOP_BANNER: 'discover_top_banner',
  DISCOVER_INLINE_1: 'discover_inline_1',
  EMPTY_STATE_PROMO: 'empty_state_promo',
  HOUSE_UPGRADE_CARD: 'house_upgrade_card',
};

export const PLACEMENT_CONFIG = {
  [PLACEMENTS.INBOX_NATIVE_1]: {
    sizes: [[300, 250], [320, 100]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_INBOX_NATIVE_1,
    label: 'Sponsored',
    lazyMargin: '200px',
    cap: { perSession: 2, coolMs: 0 },       // ✅ new
  },
  // ===== Sidebars =====
  [PLACEMENTS.SIDEBAR_PRIMARY]: {
    sizes: [[300, 250], [300, 600], [160, 600]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_SIDEBAR_PRIMARY,
    label: 'Sponsored',
    lazyMargin: '200px',
  },
  [PLACEMENTS.SIDEBAR_SECONDARY]: {
    sizes: [[300, 250], [300, 300]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_SIDEBAR_SECONDARY,
    label: 'Sponsored',
    lazyMargin: '200px',
  },

  // ===== Chat thread placements =====
  [PLACEMENTS.THREAD_INLINE_1]: {
    sizes: [[300, 250], [320, 100], [320, 50]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_THREAD_INLINE_1,
    label: 'Sponsored',
    lazyMargin: '250px',
  },
  [PLACEMENTS.CHAT_FOOTER]: {
    sizes: [[320, 50], [320, 100]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_CHAT_FOOTER,
    label: 'Sponsored',
    lazyMargin: '150px',
  },

  // ===== Contacts / People =====
  [PLACEMENTS.CONTACTS_TOP_BANNER]: {
    sizes: [[320, 50], [320, 100], [300, 250]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_CONTACTS_TOP_BANNER,
    label: 'Sponsored',
    lazyMargin: '150px',
  },
  [PLACEMENTS.CONTACTS_INLINE_1]: {
    sizes: [[300, 250], [320, 100]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_CONTACTS_INLINE_1,
    label: 'Sponsored',
    lazyMargin: '200px',
  },

  // ===== Search / Modal =====
  [PLACEMENTS.SEARCH_RESULTS_FOOTER]: {
    sizes: [[320, 50], [320, 100]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_SEARCH_RESULTS_FOOTER,
    label: 'Sponsored',
    lazyMargin: '150px',
  },
  [PLACEMENTS.START_CHAT_MODAL_FOOTER]: {
    sizes: [[320, 50]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_START_CHAT_MODAL_FOOTER,
    label: 'Sponsored',
    lazyMargin: '100px',
  },

  // ===== Discover / Status feed (if you have one) =====
  [PLACEMENTS.DISCOVER_TOP_BANNER]: {
    sizes: [[320, 50], [320, 100], [728, 90]], // 728x90 when space allows
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_DISCOVER_TOP_BANNER,
    label: 'Sponsored',
    lazyMargin: '200px',
  },
  [PLACEMENTS.DISCOVER_INLINE_1]: {
    sizes: [[300, 250]],
    adsenseSlot: import.meta.env.VITE_ADSENSE_SLOT_DISCOVER_INLINE_1,
    label: 'Sponsored',
    lazyMargin: '250px',
  },

  // ===== House-only promos (no third-party) =====
  [PLACEMENTS.EMPTY_STATE_PROMO]: {
    houseOnly: true,              // AdSlot should render <HouseAd /> here
    label: 'Promotion',
  },
  [PLACEMENTS.HOUSE_UPGRADE_CARD]: {
    houseOnly: true,              // e.g., Settings upgrade card
    label: 'Upgrade',
  },
};

// 3) Helper (optional): resolve a placement passed as an enum key or raw id string
export function getPlacementConfig(placement) {
  if (!placement) return null;
  // if they passed the enum value e.g. PLACEMENTS.SIDEBAR_PRIMARY
  if (PLACEMENT_CONFIG[placement]) return PLACEMENT_CONFIG[placement];
  // if they passed the raw id string e.g. 'sidebar_primary'
  const direct = PLACEMENT_CONFIG[String(placement)];
  return direct || null;
}
