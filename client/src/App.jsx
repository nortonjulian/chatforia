import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import DevErrorBoundary from '@/components/DevErrorBoundary.jsx';
import AppRoutes from './AppRoutes';

import posthog from '@/utils/analytics';

export default function App() {
  const { pathname } = useLocation();

  useEffect(() => {
    const el = document.getElementById('main-content');
    if (el) el.focus();
  }, [pathname]);

  useEffect(() => {
    posthog.capture('test_event');
  }, []);

  return (
    <>
      <DevErrorBoundary>
        <AppRoutes />
      </DevErrorBoundary>
    </>
  );
}