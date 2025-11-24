import { useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';

export default function PortRequestsList() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/api/porting');
        if (!cancelled) {
          setRequests(res.data || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(t('wireless.status.loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const STATUS_LABELS = {
    PENDING: t('wireless.status.pending'),
    SUBMITTED: t('wireless.status.submitted'),
    IN_PROGRESS: t('wireless.status.inProgress'),
    COMPLETED: t('wireless.status.completed'),
    FAILED: t('wireless.status.failed'),
    CANCELED: t('wireless.status.canceled'),
  };

  if (loading) {
    return (
      <p className="text-sm text-gray-500">
        {t('wireless.status.loading')}
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-red-600">
        {error}
      </p>
    );
  }
  if (!requests.length) {
    return (
      <p className="text-sm text-gray-500">
        {t('wireless.status.none')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <div key={r.id} className="rounded border px-3 py-2 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">
                {r.phoneNumber} &middot; {STATUS_LABELS[r.status] ?? r.status}
              </div>
              <div className="text-xs text-gray-500">
                {t('wireless.status.created')}{' '}
                {new Date(r.createdAt).toLocaleString()}
              </div>
              {r.scheduledAt && (
                <div className="text-xs text-gray-500">
                  {t('wireless.status.scheduled')}{' '}
                  {new Date(r.scheduledAt).toLocaleString()}
                </div>
              )}
              {r.completedAt && (
                <div className="text-xs text-gray-500">
                  {t('wireless.status.completedAt')}{' '}
                  {new Date(r.completedAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
          {r.statusReason && (
            <div className="mt-1 text-xs text-gray-600">
              {r.statusReason}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
