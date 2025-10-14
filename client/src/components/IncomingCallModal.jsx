import { useState } from 'react';
import { useCall } from '../context/CallContext';
import { toast } from '../utils/safeToast';

export default function IncomingCallModal() {
  const call = useCall();

  if (!call || !call.incoming) return null;

  const {
    incoming,
    acceptCall,
    rejectCall,
    accept,   // support alias
    reject,   // support alias
    onAccept, // support alias/callback
    onReject, // support alias/callback
  } = call;

  const doAccept = acceptCall || accept || onAccept;
  const doReject = rejectCall || reject || onReject;

  // 'accept' | 'reject' | null
  const [pending, setPending] = useState(null);

  const handleAccept = async () => {
    // Only block re-clicking Accept while Accept is pending
    if (pending === 'accept') return;
    setPending('accept');
    try {
      await doAccept?.();
      toast.ok('Call started');
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Failed to accept call';
      toast.err(msg);
    } finally {
      setPending(null);
    }
  };

  const handleReject = async () => {
    // Only block re-clicking Reject while Reject is pending
    if (pending === 'reject') return;
    setPending('reject');
    try {
      await doReject?.();
      toast.info('Call declined');
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Failed to decline call';
      toast.err(msg);
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Incoming call"
    >
      <div className="bg-white rounded-xl p-6 w-[360px] shadow-xl">
        <h3 className="text-lg font-semibold mb-1">
          Incoming {incoming.mode === 'VIDEO' ? 'Video' : 'Audio'} Call
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          from{' '}
          {incoming.fromUser?.name ??
            incoming.fromUser?.username ??
            (incoming.fromUser?.id
              ? `User ${incoming.fromUser.id}`
              : 'Unknown caller')}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleReject}
            // only disable the reject button while reject is pending
            disabled={pending === 'reject'}
            className="px-4 py-2 rounded-lg bg-gray-200 disabled:opacity-60"
            data-testid="decline"
          >
            {pending === 'reject' ? 'Declining…' : 'Decline'}
          </button>
          <button
            onClick={handleAccept}
            // only disable the accept button while accept is pending
            disabled={pending === 'accept'}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-60"
            data-testid="accept"
          >
            {pending === 'accept' ? 'Connecting…' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
