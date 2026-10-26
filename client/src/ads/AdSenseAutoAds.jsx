import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useUser } from '@/context/UserContext';

const ADSENSE_CLIENT = 'ca-pub-8163977681153105';

const EXCLUDED_PREFIXES = [
  // Public invite links need a clear call to action, without Auto ad overlays.
  '/join/',
  '/family/join/',
  '/chat',
  '/calls',
  '/video',
  '/random',
  '/people',
  '/dialer',
  '/voicemail',
  '/pricing',
  '/mobile/esim',
];

const GUEST_AUTH_PATHS = new Set([
  '/',
  '/register',
  '/verify-email',
  '/verify-phone-consent',
  '/verify-code',
  '/forgot-password',
  '/reset-password',
  '/auth/complete',
]);

function isPaidUser(user) {
  const plan = String(user?.plan || '').toLowerCase();
  const tier = String(user?.subscription?.tier || user?.subscriber?.tier || '').toLowerCase();

  return Boolean(
    user?.isPremium ||
      plan === 'plus' ||
      plan === 'premium' ||
      tier === 'plus' ||
      tier === 'premium'
  );
}

export default function AdSenseAutoAds() {
  const { currentUser, authLoading } = useUser();
  const location = useLocation();

  useEffect(() => {
    if (authLoading) return;

    const adsEnabled = import.meta.env.VITE_ADS_ENABLED !== 'false';

    const isExcludedRoute = EXCLUDED_PREFIXES.some((prefix) =>
      location.pathname.startsWith(prefix)
    );

    // The guest landing/login and registration flows must never initialize
    // Auto ads. For signed-in users, '/' may be the main app, so don't
    // globally suppress that route here.
    const isGuestAuthRoute =
      !currentUser && GUEST_AUTH_PATHS.has(location.pathname);

    const shouldLoadAds =
      adsEnabled &&
      !isPaidUser(currentUser) &&
      !isExcludedRoute &&
      !isGuestAuthRoute;
    
    if (!shouldLoadAds) return;

    if (document.querySelector('script[data-chatforia-adsense="true"]')) return;

    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.chatforiaAdsense = 'true';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

    document.head.appendChild(script);
  }, [authLoading, currentUser, location.pathname]);

  return null;
}