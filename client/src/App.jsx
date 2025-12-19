import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import DevErrorBoundary from '@/components/DevErrorBoundary.jsx';
import AppRoutes from './AppRoutes';

export default function App() {
  const { pathname } = useLocation();

  useEffect(() => {
    const el = document.getElementById('main-content');
    if (el) el.focus();
  }, [pathname]);

  return(
    <>
     <DevErrorBoundary>
      <AppRoutes />
     </DevErrorBoundary>
    </>
  )
}
