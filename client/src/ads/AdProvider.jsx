import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PLACEMENT_CONFIG } from './placements';

/**
 * One flag to rule them all:
 *   adsense  → quick start
 *   prebid   → header bidding with GAM (Google Ad Manager)
 */
const ADAPTER = (import.meta.env.VITE_ADAPTER || 'adsense').toLowerCase();

/** AdSense */
const ADSENSE_CLIENT = import.meta.env.VITE_ADSENSE_CLIENT; // e.g. 'ca-pub-123456...'

/** Prebid + GAM */
const GAM_AD_UNIT_PATH =
  import.meta.env.VITE_GAM_AD_UNIT_PATH || '/1234567/chatforia';
const PREBID_TIMEOUT = Number(import.meta.env.VITE_PREBID_TIMEOUT ?? 1200);

/**
 * Optional (but recommended) bidder config source – JSON encoded mapping:
 *  {
 *    "chat-list-top":  [
 *      { "bidder": "appnexus", "params": { "placementId": "11111111" } }
 *    ],
 *    "chat-list-between": [
 *      { "bidder": "appnexus", "params": { "placementId": "22222222" } }
 *    ]
 *  }
 */
let _BIDDER_MAP = {};
try {
  _BIDDER_MAP = JSON.parse(import.meta.env.VITE_PREBID_BIDDERS_JSON || '{}');
} catch {
  _BIDDER_MAP = {};
}

/** Replace this with your CMP wiring if you run personalized ads */
function useConsent() {
  return { hasConsent: true, tcfString: null, usPrivacy: null };
}

const AdCtx = createContext(null);
export function useAds() {
  return useContext(AdCtx);
}

function loadScriptOnce(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    Object.entries(attrs).forEach(([k, v]) => (s[k] = v));
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export function AdProvider({ isPremium = false, children }) {
  const consent = useConsent();
  const [ready, setReady] = useState(false);
  const loadedRef = useRef(false); // StrictMode guard

  // ╭──────────────────────────────────────────────────────────────────────────╮
  // │            Impression caps / cool-downs (per session)                    │
  // ╰──────────────────────────────────────────────────────────────────────────╯
  // imps = { "placement:key": { count: number, last: timestampMs } }
  const [imps, setImps] = useState({});

  const canShow = (placement, key = 'global') => {
    if (isPremium) return false;
    const cfg = PLACEMENT_CONFIG[placement] || {};
    const cap = cfg.cap || { perSession: Infinity, coolMs: 0 };
    const k = `${placement}:${key}`;
    const it = imps[k] || { count: 0, last: 0 };
    if (it.count >= cap.perSession) return false;
    if (Date.now() - it.last < cap.coolMs) return false;
    return true;
  };

  const markShown = (placement, key = 'global') => {
    const k = `${placement}:${key}`;
    setImps((prev) => {
      const it = prev[k] || { count: 0, last: 0 };
      return { ...prev, [k]: { count: it.count + 1, last: Date.now() } };
    });
  };

  // ---- Prebid/GAM dynamic registries (dedupe across slots) ----
  // window-scoped so repeated mounts don’t redefine
  function ensureGlobals() {
    window.pbjs = window.pbjs || { que: [] };
    window.googletag = window.googletag || { cmd: [] };
    window.__PREBID_UNITS__ = window.__PREBID_UNITS__ || new Set(); // codes
    window.__GAM_SLOTS__ = window.__GAM_SLOTS__ || new Set();       // codes
    window.__GAM_SERVICES_ENABLED__ = window.__GAM_SERVICES_ENABLED__ || false;
  }

  /** Ensure a Prebid adUnit + GPT slot exist for a placement (sizes [[w,h],...]) */
  function ensurePrebid(code, sizes) {
    if (ADAPTER !== 'prebid') return;
    ensureGlobals();
    const { pbjs, googletag } = window;
    if (!pbjs || !googletag) return;

    // 1) Prebid adUnit (once per code)
    if (!window.__PREBID_UNITS__.has(code)) {
      const bids = Array.isArray(_BIDDER_MAP[code]) ? _BIDDER_MAP[code] : [];
      pbjs.que.push(() => {
        pbjs.addAdUnits([
          {
            code,
            mediaTypes: { banner: { sizes } },
            bids, // <-- fill via VITE_PREBID_BIDDERS_JSON
          },
        ]);
      });
      window.__PREBID_UNITS__.add(code);
    }

    // 2) GPT slot (once per code)
    if (!window.__GAM_SLOTS__.has(code)) {
      const domId = `gpt-${code}`;
      googletag.cmd.push(() => {
        const slot = googletag.defineSlot(GAM_AD_UNIT_PATH, sizes, domId);
        if (slot) {
          slot.addService(googletag.pubads());
          // Example: slot.setTargeting('pos', code);
          window.__GAM_SLOTS__.add(code);
        }
        if (!window.__GAM_SERVICES_ENABLED__) {
          googletag.pubads().enableSingleRequest();
          googletag.enableServices();
          window.__GAM_SERVICES_ENABLED__ = true;
        }
      });
    }
  }

  // Load libraries for chosen adapter
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (loadedRef.current) return;
      loadedRef.current = true;

      try {
        if (ADAPTER === 'adsense') {
          if (!ADSENSE_CLIENT) {
            console.warn(
              '[ads] VITE_ADSENSE_CLIENT missing; AdSense will not render'
            );
          }
          await loadScriptOnce(
            `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`,
            { async: true, crossorigin: 'anonymous' }
          );
        } else if (ADAPTER === 'prebid') {
          ensureGlobals();
          // Load GPT first, then Prebid
          await loadScriptOnce(
            'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
            { async: true }
          );
          await loadScriptOnce(
            'https://cdn.jsdelivr.net/npm/prebid.js@latest/dist/not-for-prod/prebid.js',
            { async: true }
          );

          // Minimal Prebid config (can be extended later)
          window.pbjs.que.push(() => {
            window.pbjs.setConfig({
              priceGranularity: 'medium',
              bidderTimeout: PREBID_TIMEOUT,
              userSync: { iframeEnabled: true },
              consentManagement: {
                // Wire to your CMP as needed:
                gdpr: { cmpApi: 'iab', timeout: 800, defaultGdprScope: true },
                usp: { cmpApi: 'iab', timeout: 800 },
              },
            });
          });

          // GPT initial setup
          window.googletag.cmd.push(() => {
            // enableServices is called lazily in ensurePrebid()
          });
        }
      } catch (e) {
        console.warn('[ads] failed to load ad libraries', e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      adapter: ADAPTER,
      isPremium,
      ready,
      consent,
      // AdSense context
      adsense: { client: ADSENSE_CLIENT },
      // Prebid context
      prebid: {
        gamPath: GAM_AD_UNIT_PATH,
        timeoutMs: PREBID_TIMEOUT,
      },
      // Slot helpers
      ensurePrebid,
      // Caps API (used by AdSlot)
      canShow,
      markShown,
    }),
    [isPremium, ready, consent, imps]
  );

  return <AdCtx.Provider value={value}>{children}</AdCtx.Provider>;
}
