import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';

export default function SmsThreadsNav() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    axiosClient.get('/sms/threads').then(res => setItems(res.data?.items || [])).catch(() => {});
  }, []);
  if (!items.length) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="nav-section-title">Messages (SMS)</div>
      <div className="nav-list">
        {items.map(t => (
          <Link key={t.id} to={`/sms/${t.id}`} className="nav-item">
            {t.contactPhone}
          </Link>
        ))}
      </div>
    </div>
  );
}
