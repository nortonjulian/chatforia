import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUser } from '@/context/UserContext';
import { isPremiumUser } from '@/utils/planAccess';
import { captionAppearance } from '@/utils/callCaptions';
import axiosClient from '@/api/axiosClient';
import { observeVideoCaptions } from '@/utils/videoCaptions';

export default function VideoCallCaptions({ callId, remoteStream }) {
  const { currentUser } = useUser() || {};
  const userId = currentUser?.id;
  const enabled = !!userId && Number.isSafeInteger(Number(callId)) && Number(callId) > 0 &&
    currentUser?.a11yLiveCaptions === true && isPremiumUser(currentUser);
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const observer = useRef(null);
  const scope = `${userId}:${callId}:${enabled}:${retry}`;
  useEffect(() => {
    if (!enabled) { setResult(null); return; }
    let active = true;
    const update = patch => { if (active) setResult(previous => ({ ...(previous?.scope === scope ? previous : {}), scope, ...patch })); };
    const stop = observeVideoCaptions({ api: axiosClient, callId, remoteStream,
      onText: text => update({ text }), onStatus: status => update({ status }),
    });
    observer.current = stop;
    return () => { active = false; observer.current = null; stop(); };
  }, [enabled, scope, callId, remoteStream]);
  const progress = ['connecting', 'reconnecting'].includes(result?.status);
  if (!enabled || result?.scope !== scope || (!result.text && result.status !== 'error' && !progress)) return null;
  const error = result.status === 'error';
  return createPortal(
    <div role="status" aria-live="polite" aria-atomic="true" data-testid="video-call-captions"
      style={{ position: 'fixed', bottom: 'max(110px, 14vh)', left: '50%', transform: 'translateX(-50%)',
        zIndex: 1100, maxWidth: '90vw', width: 'max-content', maxHeight: '30vh', overflow: 'hidden',
        pointerEvents: error ? 'auto' : 'none', padding: '12px 18px', borderRadius: 12, lineHeight: 1.5,
        overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', ...captionAppearance(currentUser.a11yCaptionFont, currentUser.a11yCaptionBg) }}>
      {error ? <>Live captions are unavailable. <button type="button" onClick={() => {
        if (observer.current?.retry) observer.current.retry();
        else setRetry(n => n + 1);
      }}>Retry captions</button></> : progress
        ? (result.status === 'reconnecting' ? 'Reconnecting live captions…' : 'Connecting live captions…')
        : result.text}
    </div>, document.body
  );
}
