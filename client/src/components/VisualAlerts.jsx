import { useEffect, useRef } from 'react';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useUser } from '@/context/UserContext';
import { useSocketRaw } from '@/context/SocketContext';
import { attachVisualAlerts } from '@/utils/visualAlerts';

export default function VisualAlerts() {
  const { currentUser } = useUser() ?? {};
  const socket = useSocketRaw();
  const { t } = useTranslation();
  const latest = useRef();
  latest.current = { user: currentUser, t };
  const controller = useRef(null);
  const userId = currentUser?.id;

  useEffect(() => {
    if (!socket || !userId) return;
    const alerts = attachVisualAlerts({
      socket, userId,
      getEnabled: () => latest.current.user?.id === userId && latest.current.user?.a11yVisualAlerts === true,
      getLabels: () => ({
        message: latest.current.t('visualAlerts.newMessage', 'New message'),
        call: latest.current.t('visualAlerts.incomingCall', 'Incoming call'),
        body: latest.current.t('visualAlerts.returnToChat', 'Return to Chatforia to view it.'),
      }),
      show: (options) => notifications.show({ ...options, autoClose: 5000, withCloseButton: true }),
      hide: (id) => notifications.hide(id),
    });
    controller.current = alerts;
    return () => {
      alerts.dispose();
      controller.current = null;
    };
  }, [socket, userId]);

  useEffect(() => {
    controller.current?.syncPreference();
  }, [currentUser?.a11yVisualAlerts]);
  return null;
}
