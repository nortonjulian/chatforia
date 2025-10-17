import React, { useEffect, useRef } from 'react';
import { joinRoom } from './video';

export default function VideoCall({ identity, room, onEnd }) {
  const localRef = useRef(null);
  const remoteRef = useRef(null);

  useEffect(() => {
    let twilioRoom;

    function attachTrack(track, container) {
      if (!container) return;
      const el = track.attach();
      container.appendChild(el);
    }

    function detachTracks(tracks) {
      tracks.forEach((t) => t.detach().forEach((el) => el.remove()));
    }

    (async () => {
      try {
        twilioRoom = await joinRoom({ identity, room });

        // fire onEnd if room disconnects (remote hangup, network, etc.)
        twilioRoom.on('disconnected', () => {
          onEnd?.();
        });

        // Attach LOCAL tracks (already available)
        twilioRoom.localParticipant.tracks.forEach((pub) => {
          if (pub.track && localRef.current) attachTrack(pub.track, localRef.current);
        });

        // Handle future local tracks (e.g., enabling camera later)
        twilioRoom.localParticipant.on('trackPublished', (pub) => {
          pub.on('subscribed', (track) => attachTrack(track, localRef.current));
        });

        // Helper to wire a REMOTE participant
        function wireParticipant(p) {
          // Attach already-published tracks
          p.tracks.forEach((pub) => {
            if (pub.track) attachTrack(pub.track, remoteRef.current);
          });

          // Subscribe to new tracks
          p.on('trackSubscribed', (track) => attachTrack(track, remoteRef.current));

          // Cleanup on track unsubscribe
          p.on('trackUnsubscribed', (track) => {
            detachTracks([track]);
          });
        }

        // Existing participants
        twilioRoom.participants.forEach(wireParticipant);

        // New participants
        twilioRoom.on('participantConnected', wireParticipant);

        // Participant leaves
        twilioRoom.on('participantDisconnected', (p) => {
          p.tracks.forEach((pub) => {
            if (pub.track) detachTracks([pub.track]);
          });
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[video] joinRoom failed:', err);
        onEnd?.();
      }
    })();

    return () => {
      if (twilioRoom) {
        // Clean up local tracks
        twilioRoom.localParticipant.tracks.forEach((pub) => {
          if (pub.track) {
            pub.track.stop();
            detachTracks([pub.track]);
          }
        });
        // Clean up remote tracks
        twilioRoom.participants.forEach((p) => {
          p.tracks.forEach((pub) => {
            if (pub.track) detachTracks([pub.track]);
          });
        });
        twilioRoom.disconnect();
      }
      onEnd?.(); // also fire on manual close/unmount
    };
  }, [identity, room, onEnd]);

  return (
    <div className="grid gap-2">
      <div ref={localRef} className="rounded border p-1" />
      <div ref={remoteRef} className="rounded border p-1" />
    </div>
  );
}
