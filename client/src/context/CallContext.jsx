import { createContext, useContext, useEffect, useRef, useState } from 'react';
import socket from '@/lib/socket';
import { API_BASE } from '@/config';

const CallCtx = createContext(null);
export const useCall = () => useContext(CallCtx);

export function CallProvider({ children, me }) {
  const [incoming, setIncoming] = useState(null);    // { callId, fromUser, mode, offer }
  const [active, setActive] = useState(null);        // { callId, peerId }
  const pcRef = useRef(null);

  // Keep local & remote streams for UI
  const localStreamRef = useRef(null);               // MediaStream | null
  const remoteStreamRef = useRef(new MediaStream()); // always a MediaStream instance

  // socket listeners
  useEffect(() => {
    function onIncoming(payload) {
      setIncoming(payload);
    }
    function onAnswer({ callId, answer }) {
      if (!pcRef.current) return;
      pcRef.current.setRemoteDescription(answer);
      setActive((prev) => prev || { callId });
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

  async function createPeer() {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
    }
    const res = await fetch(`${API_BASE}/ice-servers?provider=all`, { credentials: 'include' });
    const { iceServers } = await res.json();

    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && active?.peerId) {
        fetch(`${API_BASE}/calls/candidate`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId: active?.callId, toUserId: active?.peerId, candidate }),
        }).catch(() => {});
      }
    };

    pc.ontrack = (e) => {
      // merge all incoming tracks into a single remote stream
      e.streams.forEach((stream) => {
        stream.getTracks().forEach((t) => {
          // prevent duplicates
          if (!remoteStreamRef.current.getTracks().find((rt) => rt.id === t.id)) {
            remoteStreamRef.current.addTrack(t);
          }
        });
      });
    };

    pcRef.current = pc;
    return pc;
  }

  async function startCall({ calleeId, mode = 'VIDEO' }) {
    const pc = await createPeer();
    const local = await navigator.mediaDevices.getUserMedia({
      video: mode === 'VIDEO',
      audio: true,
    });
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
    const { callId } = await resp.json();
    setActive({ callId, peerId: calleeId });
  }

  async function acceptCall() {
    const { callId, fromUser, offer, mode } = incoming || {};
    const pc = await createPeer();

    const local = await navigator.mediaDevices.getUserMedia({
      video: mode === 'VIDEO',
      audio: true,
    });
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

    setActive({ callId, peerId: fromUser.id });
    setIncoming(null);
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
  }

  async function endCall() {
    const callId = active?.callId || incoming?.callId;
    if (!callId) return;
    await fetch(`${API_BASE}/calls/end`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId }),
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

    // reset remote stream instance
    remoteStreamRef.current = new MediaStream();
    setActive(null);
    setIncoming(null);
  }

  const value = {
    incoming,
    active,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    pcRef,
    localStream: localStreamRef,
    remoteStream: remoteStreamRef,
  };

  return <CallCtx.Provider value={value}>{children}</CallCtx.Provider>;
}
