import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useUser } from '@/context/UserContext';

export default function SkipLink({
  targetId = 'main-content',
  requireAuth = true,
  excludePaths = [
    '/', '/register', '/forgot-password', '/reset-password',
    '/auth/complete', '/upgrade', '/upgrade/success', '/billing/return',
    '/help', '/contact', '/about', '/press', '/careers', '/advertise',
    '/download', '/guides', '/guides/getting-started', '/tips',
    '/legal/privacy', '/legal/terms', '/legal/do-not-sell', '/legal/cookies'
  ],
  label,
  labelKey = 'a11y.skipToMain',
  defaultLabel = 'Skip to main content',
}) {
  // ---- Hooks must always be called, in this order, every render ----
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const { pathname } = useLocation();

  // Is the target element present? (do this after mount to avoid SSR/DOM checks during render)
  const [hasTarget, setHasTarget] = useState(true);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setHasTarget(Boolean(document.getElementById(targetId)));
  }, [targetId, pathname]);

  // Fallback show/hide if your global .skip-link CSS isn’t loaded
  const [isFocused, setIsFocused] = useState(false);

  const resolvedLabel = t(labelKey, { defaultValue: label || defaultLabel });

  const shouldRender = useMemo(() => {
    if (requireAuth && !currentUser) return false;
    if (excludePaths.includes(pathname)) return false;
    if (!hasTarget) return false;
    return true;
  }, [requireAuth, currentUser, excludePaths, pathname, hasTarget]);

  if (!shouldRender) return null;

  // Visually hidden until focused (inline fallback)
  const hiddenStyle = {
    position: 'absolute',
    left: '-9999px',
    top: 'auto',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
  };
  const visibleStyle = {
    position: 'absolute',
    left: 8,
    top: 8,
    zIndex: 10000,
    background: 'var(--mantine-color-body, #fff)',
    color: 'inherit',
    padding: '6px 10px',
    borderRadius: 8,
    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
    textDecoration: 'none',
  };

  return (
    <a
      className="skip-link"
      href={`#${targetId}`}
      aria-label={resolvedLabel}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={isFocused ? visibleStyle : hiddenStyle}
    >
      {resolvedLabel}
    </a>
  );
}
