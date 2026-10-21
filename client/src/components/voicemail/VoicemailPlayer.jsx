import { useEffect, useState } from 'react';
import { fetchVoicemailAudio } from '@/api/voicemailApi.js';
import { useTranslation } from 'react-i18next';

/**
 * @param {Object} props
 * @param {Object} props.voicemail - Voicemail object from API
 */
export default function VoicemailPlayer({ voicemail }) {
  const { t } = useTranslation();

  const id = voicemail?.id;
  const [audio, setAudio] = useState(null);
  const [audioError, setAudioError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    let objectUrl;
    setAudio(null);
    setAudioError('');
    if (id) {
      fetchVoicemailAudio(id, controller.signal).then(blob => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setAudio({ id, url: objectUrl });
      }).catch(() => {
        if (live) setAudioError('Unable to load voicemail audio. Please try again.');
      });
    }
    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, attempt]);

  if (!voicemail) return null;

  const {
    fromNumber,
    toNumber,
    durationSec,
    createdAt,
    transcript,
    transcriptStatus,
  } = voicemail;

  const created = createdAt ? new Date(createdAt) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold">
          {t('voicemail.from')}{' '}
          <span className="font-mono">
            {fromNumber || t('voicemail.unknownCaller')}
          </span>
        </div>
        <div className="text-xs text-gray-500">
          {t('voicemail.to')}{' '}
          <span className="font-mono">
            {toNumber || t('voicemail.yourNumber')}
          </span>
        </div>
        <div className="text-xs text-gray-500">
          {created
            ? `${created.toLocaleDateString()} • ${created.toLocaleTimeString()}`
            : null}
          {durationSec != null
            ? ` • ${t('voicemail.durationSeconds', { count: durationSec })}`
            : ''}
        </div>
      </div>

      {/* Audio player */}
      <audio
        controls
        src={audio && audio.id === id ? audio.url : undefined}
        key={id}
        preload="metadata"
        className="w-full rounded border border-gray-200"
        aria-label={t('voicemail.audioAria')}
      />

      {audioError && <div role="alert">
        {audioError}{' '}
        <button type="button" onClick={() => setAttempt(n => n + 1)}>Retry audio</button>
      </div>}

      {/* Transcript section */}
      {transcriptStatus === 'COMPLETE' && transcript && transcript.trim() && (
        <div className="mt-1">
          <div className="text-xs font-semibold text-gray-600 mb-1">
            {t('voicemail.transcriptHeading')}
          </div>
          <div className="text-sm text-gray-800 whitespace-pre-line bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
            {transcript.trim()}
          </div>
        </div>
      )}

      {transcriptStatus === 'PENDING' && (
        <div className="text-xs text-gray-500">
          {t('voicemail.transcriptPending')}
        </div>
      )}

      {transcriptStatus === 'FAILED' && (
        <div className="text-xs text-gray-500">
          {t('voicemail.transcriptFailed')}
        </div>
      )}
    </div>
  );
}
