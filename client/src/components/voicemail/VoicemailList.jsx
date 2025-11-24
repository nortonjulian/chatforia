import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchVoicemails,
  setVoicemailRead,
  deleteVoicemail,
} from '@/api/voicemailApi.js';
import VoicemailPlayer from './VoicemailPlayer.jsx';

/**
 * VoicemailList
 *
 * Optional testing hooks:
 * - initialVoicemails: if provided, the component will use this list and skip the
 *   auto-fetch effect. This makes Jest tests deterministic and synchronous.
 * - initialError: if provided, the component shows the error state immediately
 *   and skips the auto-fetch as well.
 */
export default function VoicemailList({
  initialVoicemails = null,
  initialError = '',
}) {
  const { t } = useTranslation();

  const [voicemails, setVoicemails] = useState(initialVoicemails ?? []);
  const [activeId, setActiveId] = useState(
    initialVoicemails && initialVoicemails.length ? initialVoicemails[0].id : null,
  );
  const [loading, setLoading] = useState(
    initialVoicemails == null && !initialError,
  );
  const [error, setError] = useState(initialError || '');

  useEffect(() => {
    // If tests or callers provided initial data / error, skip auto-fetch entirely.
    if (initialVoicemails != null || initialError) return;

    let isMounted = true;

    (async () => {
      try {
        setLoading(true);
        const data = await fetchVoicemails();
        if (!isMounted) return;
        const list = data?.voicemails ?? [];
        setVoicemails(list);
        if (list.length && !activeId) {
          setActiveId(list[0].id);
        }
      } catch (err) {
        console.error(err);
        if (isMounted) {
          setError(t('voicemail.errorLoading'));
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, initialVoicemails, initialError]); // t is stable in real i18n; deps here keep lints happy

  const handleSelect = async (vm) => {
    setActiveId(vm.id);
    if (!vm.isRead) {
      try {
        await setVoicemailRead(vm.id, true);
        setVoicemails((prev) =>
          prev.map((v) => (v.id === vm.id ? { ...v, isRead: true } : v)),
        );
      } catch (err) {
        console.error('Failed to mark voicemail read', err);
      }
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('voicemail.deleteConfirm'))) return;
    try {
      await deleteVoicemail(id);
      setVoicemails((prev) => prev.filter((v) => v.id !== id));
      if (activeId === id) {
        const remaining = voicemails.filter((v) => v.id !== id);
        setActiveId(remaining[0]?.id ?? null);
      }
    } catch (err) {
      console.error('Failed to delete voicemail', err);
      alert(t('voicemail.deleteError'));
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-500">
        {t('voicemail.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (!voicemails.length) {
    return (
      <div className="p-4 text-sm text-gray-500">
        {t('voicemail.empty')}
      </div>
    );
  }

  const activeVoicemail =
    voicemails.find((v) => v.id === activeId) || voicemails[0];

  return (
    <div className="flex h-full">
      {/* Left: list */}
      <div className="w-1/3 border-r border-gray-200 overflow-y-auto">
        {voicemails.map((vm) => {
          const created = vm.createdAt ? new Date(vm.createdAt) : null;
          const isActive = activeId === vm.id;
          return (
            <button
              key={vm.id}
              type="button"
              onClick={() => handleSelect(vm)}
              className={[
                'w-full text-left px-3 py-2 border-b border-gray-100 flex flex-col gap-1',
                isActive ? 'bg-gray-100' : 'hover:bg-gray-50',
              ].join(' ')}
            >
              <div className="flex justify-between items-center">
                <span
                  className={`text-sm ${
                    vm.isRead
                      ? 'font-normal text-gray-800'
                      : 'font-semibold text-gray-900'
                  }`}
                >
                  {vm.fromNumber || t('voicemail.unknownCaller')}
                </span>
                <span className="text-[11px] text-gray-400">
                  {created ? created.toLocaleDateString() : ''}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs text-gray-500">
                <span>
                  {vm.durationSec != null
                    ? t('voicemail.durationSeconds', { count: vm.durationSec })
                    : ''}
                </span>
                {!vm.isRead && (
                  <span
                    className="inline-block w-2 h-2 rounded-full bg-blue-500"
                    aria-label={t('voicemail.unreadDotAria')}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Right: active voicemail details */}
      <div className="flex-1 p-4 flex flex-col gap-3">
        {activeVoicemail && (
          <>
            <VoicemailPlayer voicemail={activeVoicemail} />
            <div className="flex gap-2 mt-3">
              {!activeVoicemail.isRead && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await setVoicemailRead(activeVoicemail.id, true);
                      setVoicemails((prev) =>
                        prev.map((v) =>
                          v.id === activeVoicemail.id
                            ? { ...v, isRead: true }
                            : v,
                        ),
                      );
                    } catch (err) {
                      console.error('Failed to mark read', err);
                    }
                  }}
                  className="px-3 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100"
                >
                  {t('voicemail.markRead')}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDelete(activeVoicemail.id)}
                className="px-3 py-1 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50"
              >
                {t('voicemail.delete')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
