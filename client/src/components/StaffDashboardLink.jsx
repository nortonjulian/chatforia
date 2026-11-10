import { useEffect, useState } from 'react';
import { Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';

export default function StaffDashboardLink({ userId }) {
  const [authorizedUser, setAuthorizedUser] = useState(null);
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;
    let request = 0;
    async function checkAccess() {
      const currentRequest = ++request;
      setAuthorizedUser(null);
      if (!userId) return;
      try {
        const { data } = await axiosClient.get('/staff/session');
        if (
          active &&
          currentRequest === request &&
          typeof data?.profile === 'string' &&
          Array.isArray(data?.permissions) &&
          data.permissions.length > 0
        ) {
          setAuthorizedUser(userId);
        }
      } catch {
        // Disabled rollout, incomplete MFA, denied access, and errors hide the link.
      }
    }
    checkAccess();
    window.addEventListener('focus', checkAccess);
    return () => {
      active = false;
      window.removeEventListener('focus', checkAccess);
    };
  }, [userId]);

  if (!userId || authorizedUser !== userId) return null;
  return (
    <Button variant="subtle" size="xs" component={Link} to="/staff">
      {t('sidebar.staffDashboard', 'Staff Dashboard')}
    </Button>
  );
}
