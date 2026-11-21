import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import DevErrorBoundary from '@/components/DevErrorBoundary.jsx';
import AppRoutes from './AppRoutes';
import VisualAlerts from '@/components/VisualAlerts';

import PrivacyBanner from '@/privacy/PrivacyChoices';

export default function App() {
  const { pathname } = useLocation();

  useEffect(() => {
    const el = document.getElementById('main-content');
    if (el) el.focus();
  }, [pathname]);


  return (
    <>
      <PrivacyBanner />
      <VisualAlerts />
      <DevErrorBoundary>
        <AppRoutes />
      </DevErrorBoundary>
    </>
  );
}
