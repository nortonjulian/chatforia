import { createContext, useContext, useEffect, useRef, useState } from 'react';
import socket from '@/lib/socket';
import { API_BASE } from '@/config';

const CallCtx = createContext(null);
export const useCall = () => useContext(CallCtx);

/**
 * Server payloads (for reference):
 * - /ice-servers?provider=all -> { iceServers: [...] }
 * - POST /calls/invite
 *      body: { calleeId?: string, phoneNumber?: string, mode: 'AUDIO'|'VIDEO', offer }
 *      resp: { callId: string, peerId?: string, phoneNumber?: string, requiresInvite?: boolean, inviteUrl?: string }
 * - POST /calls/answer        body: { callId, answer }
 * - POST /calls/candidate     body: { callId, toUserId?: string, candidate }
 * - POST /calls/end           body: { callId, reason? }
 *
 * Socket events:
 * - call:incoming { callId, fromUser, mode, offer }
 * - call:answer   { callId, answer }
 * - call:candidate{ candidate }
 * - call:ended    {}
 */
export function CallProvider({ children, me }) {
  const [incoming, setIncoming] = useState(null);    // { callId, fromUser, mode, offer }
  const [active, setActive] = useState(null);        // { callId, peerId?, phoneNumber? }
  const [pending, setPending] = useState(false);     // dialing/connecting state
  const [inviteHint, setInviteHint] = useState(null); // { requiresInvite, inviteUrl? } for UI to surface

  const pcRef = useRef(null);

  // Keep local & remote streams for UI
  const localStreamRef = useRef(null);               // MediaStream | null
  const remoteStreamRef = useRef(new MediaStream()); // MediaStream (always exists)

  // socket listeners
  useEffect(() => {
    function onIncoming(payload) {
      setIncoming(payload);
    }
    function onAnswer({ callId, answer }) {
      if (!pcRef.current) return;
      pcRef.current.setRemoteDescription(answer).catch(() => {});
      setActive((prev) => prev || { callId });
      setPending(false);
    }
    function onCandidate({ candidate }) {
      if (candidate && pcRef.current) {
        pcRef.current.addIceCandidate(candidate).catch(() => {});
      }
    }
    function onEnded() {
      cleanup();
    }

    socket.on('call:incoming', onIncoming);
    socket.on('call:answer', onAnswer);
    socket.on('call:candidate', onCandidate);
    socket.on('call:ended', onEnded);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:answer', onAnswer);
      socket.off('call:candidate', onCandidate);
      socket.off('call:ended', onEnded);
    };
  }, []);

  async function createPeer(nextActive = null) {
    // Close previous peer if any
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
    }

    // Fetch ICE servers (TURN/STUN)
    const res = await fetch(`${API_BASE}/ice-servers?provider=all`, { credentials: 'include' });
    const { iceServers } = await res.json();

    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const callId = (nextActive?.callId ?? active?.callId) || null;
      const toUserId = (nextActive?.peerId ?? active?.peerId) || undefined;

      if (!callId) return;
      fetch(`${API_BASE}/calls/candidate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, toUserId, candidate }),
      }).catch(() => {});
    };

    pc.ontrack = (e) => {
      e.streams.forEach((stream) => {
        stream.getTracks().forEach((t) => {
          if (!remoteStreamRef.current.getTracks().find((rt) => rt.id === t.id)) {
            remoteStreamRef.current.addTrack(t);
          }
        });
      });
    };

    pcRef.current = pc;
    return pc;
  }

  /**
   * Start a call by userId (existing Chatforia user).
   */
  async function startCallByUser({ calleeId, mode = 'VIDEO' }) {
    if (!calleeId) throw new Error('Missing calleeId');
    setInviteHint(null);
    setPending(true);

    const pc = await createPeer();
    const local = await navigator.mediaDevices.getUserMedia({ video: mode === 'VIDEO', audio: true });
    localStreamRef.current = local;
    local.getTracks().forEach((t) => pc.addTrack(t, local));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const resp = await fetch(`${API_BASE}/calls/invite`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calleeId, mode, offer }),
    });

    const data = await resp.json(); // { callId, peerId }
    setActive({ callId: data.callId, peerId: calleeId });
    return data;
  }

  /**
   * Start a call by phone number (contact not required).
   * Server may:
   *  - route to an existing user (hidden mapping), or
   *  - trigger an invite (returns requiresInvite=true and optional inviteUrl)
   */
  async function startCallByPhone({ phoneNumber, mode = 'VIDEO' }) {
    if (!phoneNumber) throw new Error('Missing phoneNumber');
    setInviteHint(null);
    setPending(true);

    const pc = await createPeer();
    const local = await navigator.mediaDevices.getUserMedia({ video: mode === 'VIDEO', audio: true });
    localStreamRef.current = local;
    local.getTracks().forEach((t) => pc.addTrack(t, local));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const resp = await fetch(`${API_BASE}/calls/invite`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber, mode, offer }),
    });

    const data = await resp.json(); // { callId, peerId?, phoneNumber?, requiresInvite?, inviteUrl? }
    setActive({ callId: data.callId, peerId: data.peerId, phoneNumber });
    if (data?.requiresInvite) {
      // surface to UI so you can show a toast/button linking to JoinInvitePage, etc.
      setInviteHint({ requiresInvite: true, inviteUrl: data.inviteUrl || null });
      // You can optionally stop local media here if you don't want a "ringing" UI until they join:
      // cleanup();
    }
    return data;
  }

  /**
   * Backwards-compatible single entry: accepts either calleeId OR phoneNumber.
   */
  async function startCall({ calleeId, phoneNumber, mode = 'VIDEO' }) {
    if (calleeId) return startCallByUser({ calleeId, mode });
    if (phoneNumber) return startCallByPhone({ phoneNumber, mode });
    throw new Error('Provide calleeId or phoneNumber');
  }

  async function acceptCall() {
    if (!incoming) return;
    const { callId, fromUser, offer, mode } = incoming;

    const pc = await createPeer({ callId, peerId: fromUser?.id });
    const local = await navigator.mediaDevices.getUserMedia({ video: mode === 'VIDEO', audio: true });
    localStreamRef.current = local;
    local.getTracks().forEach((t) => pc.addTrack(t, local));

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await fetch(`${API_BASE}/calls/answer`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, answer }),
    });

    setActive({ callId, peerId: fromUser?.id });
    setIncoming(null);
    setPending(false);
  }

  async function rejectCall() {
    if (!incoming) return;
    await fetch(`${API_BASE}/calls/end`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: incoming.callId, reason: 'rejected' }),
    }).catch(() => {});
    setIncoming(null);
    setPending(false);
  }

  async function endCall(reason) {
    const callId = active?.callId || incoming?.callId;
    if (!callId) return;
    await fetch(`${API_BASE}/calls/end`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, reason }),
    }).catch(() => {});
    cleanup();
  }

  function cleanup() {
    try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()); } catch {}
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;

    if (localStreamRef.current) {
      try { localStreamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
      localStreamRef.current = null;
    }

    remoteStreamRef.current = new MediaStream();
    setActive(null);
    setIncoming(null);
    setPending(false);
    setInviteHint(null);
  }

  const value = {
    // state
    incoming,
    active,
    pending,
    inviteHint,      // { requiresInvite, inviteUrl? } -> show CTA / toast / modal

    // streams
    pcRef,
    localStream: localStreamRef,
    remoteStream: remoteStreamRef,

    // actions
    startCall,           // { calleeId? | phoneNumber?, mode? }
    startCallByUser,     // explicit user-id call
    startCallByPhone,    // explicit phone-number call
    acceptCall,
    rejectCall,
    endCall,
    cleanup,
  };

  return <CallCtx.Provider value={value}>{children}</CallCtx.Provider>;
}
