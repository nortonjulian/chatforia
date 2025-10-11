import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import HouseAdSlot from '@/ads/HouseAdSlot';

export default function App() {
  const { pathname } = useLocation();

  useEffect(() => {
    const el = document.getElementById('main-content');
    if (el) el.focus();
  }, [pathname]);

  return(
    <>
    <AppRoutes />;
    </>
  )
}
