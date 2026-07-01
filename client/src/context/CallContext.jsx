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

  const peerConnectionsRef = useRef({});
  const pcRef = useRef(null); // keep for backwards compatibility
  const [participants, setParticipants] = useState([]);

  // Keep local & remote streams for UI
  const localStreamRef = useRef(null);               // MediaStream | null
  const remoteStreamRef = useRef(new MediaStream()); // MediaStream (always exists)

  // socket listeners
  useEffect(() => {
  function normalizeIncoming(payload, fallbackMode = 'AUDIO') {
    const callerId = payload?.callerId ?? payload?.fromUser?.id ?? null;

    const callerName =
      payload?.callerName ||
      payload?.fromUser?.displayName ||
      payload?.fromUser?.username ||
      'Chatforia user';

    return {
      ...payload,
      mode: payload?.mode || fallbackMode,
      fromUser: payload?.fromUser || {
        id: callerId,
        username: callerName,
        displayName: callerName,
        name: callerName,
      },
    };
  }

  function onIncoming(payload) {
    setIncoming(normalizeIncoming(payload, payload?.mode || 'AUDIO'));
  }

  function onVideoIncoming(payload) {
    setIncoming(normalizeIncoming(payload, 'VIDEO'));
  }

  function onAnswer({ callId, answer }) {
    if (!pcRef.current) return;
    pcRef.current.setRemoteDescription(answer).catch(() => {});
    setActive((prev) => prev || { callId });
    setPending(false);
  }

  function onCandidate({ fromUserId, candidate }) {
    if (!candidate) return;

    const pc =
      (fromUserId ? getPeerConnection(fromUserId) : null) ||
      pcRef.current;

    if (pc) {
      pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  function onEnded() {
    cleanup();
  }

  socket.on('call:incoming', onIncoming);
  socket.on('video:incoming', onVideoIncoming);
  socket.on('call:answer', onAnswer);
  socket.on('call:candidate', onCandidate);
  socket.on('call:ended', onEnded);
  socket.on('video:ended', onEnded);

  socket.on('call:participant-invite', onParticipantInvite);
  socket.on('call:participant-answer', onParticipantAnswer);
  socket.on('call:participant-ringing', onParticipantRinging);
  socket.on('call:participant-joined', onParticipantJoined);
  socket.on('call:participant-left', onParticipantLeft);
  socket.on('call:participant-declined', onParticipantDeclined);
  socket.on('call:participant-offer-needed', onParticipantOfferNeeded);
  socket.on('call:participant-offer', onParticipantOffer);

  return () => {
    socket.off('call:incoming', onIncoming);
    socket.off('video:incoming', onVideoIncoming);
    socket.off('call:answer', onAnswer);
    socket.off('call:candidate', onCandidate);
    socket.off('call:ended', onEnded);
    socket.off('video:ended', onEnded);

    socket.off('call:participant-invite', onParticipantInvite);
    socket.off('call:participant-answer', onParticipantAnswer);
    socket.off('call:participant-ringing', onParticipantRinging);
    socket.off('call:participant-joined', onParticipantJoined);
    socket.off('call:participant-left', onParticipantLeft);
    socket.off('call:participant-declined', onParticipantDeclined);
    socket.off('call:participant-offer-needed', onParticipantOfferNeeded);
    socket.off('call:participant-offer', onParticipantOffer);
  };
}, []);

  async function createPeer(nextActive = null) {
    const peerUserId = nextActive?.peerId;

    if (peerUserId) {
      closePeerConnection(peerUserId);
    }

    const res = await fetch(`${API_BASE}/ice-servers?provider=all`, {
      credentials: 'include',
    });

    const { iceServers } = await res.json();
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;

      const callId = nextActive?.callId ?? active?.callId;
      const toUserId = nextActive?.peerId;

      if (!callId || !toUserId) return;

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

  if (peerUserId) {
    setPeerConnection(peerUserId, pc);
  } else {
    pcRef.current = pc;
  }

  return pc;
}

async function addParticipant(userId) {
  if (!active?.callId) throw new Error('No active call');
  if (active.mode && active.mode !== 'AUDIO') {
    throw new Error('Adding a person is only available for audio calls');
  }

  const existingIds = participants.map((p) => Number(p.userId));
  if (existingIds.includes(Number(userId))) {
    throw new Error('This person is already in the call');
  }

  if (participants.filter((p) => ['RINGING', 'JOINED'].includes(p.status)).length >= 3) {
    throw new Error('This call already has 3 people');
  }

  let local = localStreamRef.current;

  if (!local) {
    local = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    localStreamRef.current = local;
  }

  const pc = await createPeer({
    callId: active.callId,
    peerId: Number(userId),
  });

  local.getTracks().forEach((track) => pc.addTrack(track, local));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const resp = await fetch(`${API_BASE}/calls/${active.callId}/add-participant`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: Number(userId),
      offer,
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data?.error || 'Failed to add participant');
  }

  setParticipants((prev) => {
    const without = prev.filter((p) => Number(p.userId) !== Number(userId));
    return [...without, data.participant];
  });

  return data;
}

  /**
   * Start a call by userId (existing Chatforia user).
   */
  async function startCallByUser({ calleeId, mode = 'VIDEO', peerName }) {
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
    setActive({
      callId: data.callId,
      peerId: calleeId,
      mode,
      peerName,
    });
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
    setActive({ callId: data.callId, peerId: data.peerId, phoneNumber, mode });
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
  async function startCall({ calleeId, mode = 'VIDEO', peerName }) {
    if (calleeId) return startCallByUser({ calleeId, mode, peerName });

    throw new Error('Provide calleeId');
  }

  async function acceptCall() {
    if (!incoming) return;

    const { callId, fromUser, offer, mode = 'AUDIO' } = incoming;

    const peerName =
      incoming.callerName ||
      fromUser?.displayName ||
      fromUser?.name ||
      fromUser?.username ||
      'Chatforia user';

    if (incoming.isParticipantInvite) {
      const pc = await createPeer({ callId, peerId: fromUser?.id });

      const local = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      });

      localStreamRef.current = local;
      local.getTracks().forEach((t) => pc.addTrack(t, local));

      await pc.setRemoteDescription(offer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await fetch(`${API_BASE}/calls/${callId}/answer-participant`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer,
          toUserId: fromUser?.id,
        }),
      });

      setActive({
        callId,
        peerId: fromUser?.id,
        mode: 'AUDIO',
        peerName,
      });

      setParticipants([
        ...(incoming.participants || []),
        {
          userId: me?.id,
          status: 'JOINED',
          role: 'MEMBER',
          user: me,
        },
      ]);

      setIncoming(null);
      setPending(false);
      return;
    }

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

    setActive({
      callId,
      peerId: fromUser?.id,
      mode,
      peerName,
    });

    setIncoming(null);
    setPending(false);
  }

  async function createOfferForParticipant(targetUserId) {
  if (!active?.callId) return;

  let local = localStreamRef.current;

  if (!local) {
    local = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: true,
    });
    localStreamRef.current = local;
  }

  const pc = await createPeer({
    callId: active.callId,
    peerId: Number(targetUserId),
  });

  local.getTracks().forEach((track) => pc.addTrack(track, local));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await fetch(`${API_BASE}/calls/${active.callId}/participant-offer`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toUserId: Number(targetUserId),
      offer,
    }),
  });
}

async function onParticipantOfferNeeded({ participant }) {
  try {
    await createOfferForParticipant(participant.userId);
  } catch (err) {
    console.error('Failed to create participant offer', err);
  }
}

async function onParticipantOffer({ callId, fromUser, offer }) {
  const pc = await createPeer({
    callId,
    peerId: fromUser.id,
  });

  let local = localStreamRef.current;

  if (!local) {
    local = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: true,
    });
    localStreamRef.current = local;
  }

  local.getTracks().forEach((track) => pc.addTrack(track, local));

  await pc.setRemoteDescription(offer);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await fetch(`${API_BASE}/calls/${callId}/answer-participant`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answer,
      toUserId: fromUser.id,
    }),
  });
}

  async function rejectCall() {
    if (!incoming) return;

    const url = incoming.isParticipantInvite
      ? `${API_BASE}/calls/${incoming.callId}/decline-participant`
      : `${API_BASE}/calls/end`;

    const body = incoming.isParticipantInvite
      ? {}
      : { callId: incoming.callId, reason: 'rejected' };

    await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  function onParticipantInvite(payload) {
  setIncoming({
    ...payload,
    isParticipantInvite: true,
  });
}

function onParticipantAnswer({ fromUserId, answer, participant }) {
  const pc = getPeerConnection(fromUserId);
  if (pc && answer) {
    pc.setRemoteDescription(answer).catch(() => {});
  }

  setParticipants((prev) => {
    const without = prev.filter((p) => Number(p.userId) !== Number(fromUserId));
    return [...without, participant];
  });

  setPending(false);
}

function onParticipantRinging({ participant }) {
  setParticipants((prev) => {
    const without = prev.filter((p) => Number(p.userId) !== Number(participant.userId));
    return [...without, participant];
  });
}

function onParticipantJoined({ participant }) {
  setParticipants((prev) => {
    const without = prev.filter((p) => Number(p.userId) !== Number(participant.userId));
    return [...without, participant];
  });
}

function onParticipantLeft({ participant }) {
  closePeerConnection(participant.userId);

  setParticipants((prev) =>
    prev.map((p) =>
      Number(p.userId) === Number(participant.userId)
        ? participant
        : p
    )
  );
}

function onParticipantDeclined({ participant }) {
  closePeerConnection(participant.userId);

  setParticipants((prev) =>
    prev.map((p) =>
      Number(p.userId) === Number(participant.userId)
        ? participant
        : p
    )
  );
}

  function setPeerConnection(peerUserId, pc) {
    peerConnectionsRef.current[String(peerUserId)] = pc;
    pcRef.current = pc;
  }

  function getPeerConnection(peerUserId) {
    return peerConnectionsRef.current[String(peerUserId)] || null;
  }

  function closePeerConnection(peerUserId) {
  const key = String(peerUserId);
  const pc = peerConnectionsRef.current[key];

  if (pc) {
    try {
      pc.getReceivers().forEach((receiver) => {
        const track = receiver.track;
        if (!track) return;

        try {
          track.stop();
        } catch {}

        try {
          remoteStreamRef.current.removeTrack(track);
        } catch {}
      });
    } catch {}

    try {
      pc.getSenders().forEach((sender) => {
        try {
          sender.track?.stop();
        } catch {}
      });
    } catch {}

    try {
      pc.close();
    } catch {}
  }

  delete peerConnectionsRef.current[key];
}

  function cleanup() {
    const connections = [
      ...Object.values(peerConnectionsRef.current),
      pcRef.current,
    ].filter(Boolean);

    const uniqueConnections = [...new Set(connections)];

    uniqueConnections.forEach((pc) => {
      try {
        pc.getSenders().forEach((sender) => {
          sender.track?.stop();
        });
      } catch {}

      try {
        pc.close();
      } catch {}
    });

    peerConnectionsRef.current = {};
    pcRef.current = null;

    if (localStreamRef.current) {
      try {
        localStreamRef.current
          .getTracks()
          .forEach((track) => track.stop());
      } catch {}

      localStreamRef.current = null;
    }

    remoteStreamRef.current = new MediaStream();

    setActive(null);
    setIncoming(null);
    setPending(false);
    setInviteHint(null);
    setParticipants([]);
  }

  const value = {
    // state
    incoming,
    active,
    pending,
    inviteHint,  // { requiresInvite, inviteUrl? } -> show CTA / toast / modal
    me,

    participants,
    addParticipant,
    peerConnectionsRef,

    // streams
    pcRef,
    localStream: localStreamRef,
    remoteStream: remoteStreamRef,

    // actions
    startCall,           // { calleeId? | phoneNumber?, mode? }
    startCallByUser,     // explicit user-id call
    acceptCall,
    rejectCall,
    endCall,
    cleanup,
  };

  return <CallCtx.Provider value={value}>{children}</CallCtx.Provider>;
}
