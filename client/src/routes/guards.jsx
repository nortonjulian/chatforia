import { Navigate } from 'react-router-dom';
import { Center, Loader } from '@mantine/core';
import { useUser } from '@/context/UserContext';

function LoadingScreen() {
  // Small, reusable loading UI while we resolve the user
  return (
    <Center mih="50vh">
      <Loader />
    </Center>
  );
}

/**
 * RequireAuth
 * - Blocks routes until the user is loaded.
 * - Redirects unauthenticated users to "/" (your LoginForm).
 */
export function RequireAuth({ children }) {
  const { currentUser, authLoading } = useUser() || {};
  if (authLoading) return <LoadingScreen />;
  if (!currentUser) return <Navigate to="/" replace />;
  return children;
}

/**
 * RequirePremium
 * - Requires Premium (or Admin) to view a route.
 * - Non-premium users are redirected to /settings/upgrade.
 */
export function RequirePremium({ children, allowAdmin = true }) {
  const { currentUser, authLoading } = useUser() || {};
  if (authLoading) return <LoadingScreen />;

  const plan = (currentUser?.plan || 'FREE').toUpperCase();
  const isAdmin = currentUser?.role === 'ADMIN';
  const isPremiumPlan = ['PREMIUM', 'PRO', 'PLUS'].includes(plan);

  const ok = allowAdmin ? (isAdmin || isPremiumPlan) : isPremiumPlan;
  return ok ? children : <Navigate to="/settings/upgrade" replace />;
}
