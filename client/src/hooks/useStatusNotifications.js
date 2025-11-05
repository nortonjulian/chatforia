import { useEffect } from 'react';
import { useSocket } from '@/context/SocketContext';
import { useStatusNotifStore } from '@/stores/statusNotifStore';
import { notifications } from '@mantine/notifications';

export default function useStatusNotifications() {
  const { on, off } = useSocket();
  const inc = useStatusNotifStore((s) => s.inc);
  const setLastEvent = useStatusNotifStore((s) => s.setLastEvent);

  useEffect(() => {
    const onPosted = (evt) => {
      setLastEvent(evt);
      inc();
      const who = evt?.author?.username || `user${evt?.authorId}`;
      notifications.show({ title: 'New status', message: `New status from ${who}`, autoClose: 2500 });
    };
    on?.('status:posted', onPosted);
    return () => off?.('status:posted', onPosted);
  }, [on, off, inc, setLastEvent]);
}
