import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useUser } from '@/context/UserContext';

const ADSENSE_CLIENT = 'ca-pub-8163977681153105';

const EXCLUDED_PREFIXES = [
  '/chat',
  '/calls',
  '/video',
  '/random',
  '/people',
  '/dialer',
  '/voicemail',
  '/pricing',
];

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

    const shouldLoadAds =
    adsEnabled &&
    !isPaidUser(currentUser) &&
    !isExcludedRoute;
    
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