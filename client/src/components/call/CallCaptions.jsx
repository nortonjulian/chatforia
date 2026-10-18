import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUser } from '@/context/UserContext';
import { useSocketRaw } from '@/context/SocketContext';
import { isPremiumUser } from '@/utils/planAccess';
import { captionAppearance, subscribeCallCaptions } from '@/utils/callCaptions';

export default function CallCaptions({ callId }) {
  const { currentUser } = useUser() || {};
  const socket = useSocketRaw();
  const userId = currentUser?.id;
  const enabled = !!userId && currentUser?.a11yLiveCaptions === true && isPremiumUser(currentUser);
  const [caption, setCaption] = useState(null);

  useEffect(() => {
    setCaption(null);
    if (!enabled) return undefined;
    return subscribeCallCaptions({ socket, callId,
      onText: (text) => setCaption({ text, callId: String(callId), userId, socket }),
    });
  }, [socket, callId, userId, enabled]);

  // Scope synchronously as well as in effect cleanup: no previous-call/account flash.
  if (!enabled || !caption || caption.callId !== String(callId) ||
      caption.userId !== userId || caption.socket !== socket) return null;

  return createPortal(
    <div role="status" aria-live="polite" aria-atomic="true" data-testid="call-captions"
      style={{ position: 'fixed', bottom: 'max(110px, 14vh)', left: '50%',
        transform: 'translateX(-50%)', zIndex: 1100, maxWidth: '90vw',
        width: 'max-content', maxHeight: '30vh', overflow: 'hidden',
        pointerEvents: 'none', padding: '12px 18px', borderRadius: 12,
        lineHeight: 1.5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
        ...captionAppearance(currentUser.a11yCaptionFont, currentUser.a11yCaptionBg) }}>
      {caption.text}
    </div>, document.body
  );
}
