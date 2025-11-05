import { useEffect, useState } from 'react';
import { useSocket } from '@/context/SocketContext';

export default function StatusFeed() {
  const socket = useSocket();
  const [tick, setTick] = useState(0);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);

  const load = async (reset = false) => {
    const qs = new URLSearchParams();
    qs.set('limit', '20');
    // Add tab=... if you support tabs
    if (!reset && cursor) qs.set('cursor', cursor);
    const res = await fetch(`/status/feed?${qs.toString()}`, { credentials: 'include' });
    const data = await res.json();
    setItems(reset ? data.items : [...items, ...data.items]);
    setCursor(data.nextCursor);
  };

  useEffect(() => { load(true); /* initial */ }, [tick]);

  useEffect(() => {
    if (!socket) return;
    const onPosted = () => setTick((x) => x + 1);   // force a refetch
    const onDeleted = () => setTick((x) => x + 1);  // keep list consistent
    socket.on('status:posted', onPosted);
    socket.on('status_deleted', onDeleted);
    return () => {
      socket.off('status:posted', onPosted);
      socket.off('status_deleted', onDeleted);
    };
  }, [socket]);

  return (
    /* render list from `items` */
    // …
    null
  );
}
