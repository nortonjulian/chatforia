import { useEffect, useRef, useState } from 'react';
import { useCall } from '../../context/CallContext';
import AddCallParticipantModal from './AddCallParticipantModal';

export default function CallScreen() {
  const {
    active,
    status,
    localStream,
    remoteStream,
    endCall,
    participants = [],
    addParticipant,
    me,
  } = useCall();

  const [addOpen, setAddOpen] = useState(false);

  const localRef = useRef(null);
  const remoteRef = useRef(null);

  useEffect(() => {
    if (localRef.current && localStream?.current) {
      localRef.current.srcObject = localStream.current;
    }
  }, [active, localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteStream?.current) {
      remoteRef.current.srcObject = remoteStream.current;
    }
  }, [active, remoteStream]);

  if (!active) return null;

  const isVideo = active.mode === 'VIDEO';

  const activeParticipants = participants.filter((p) =>
    ['RINGING', 'JOINED'].includes(p.status)
  );

  const existingParticipantIds = activeParticipants
    .map((p) => Number(p.userId))
    .filter(Boolean);

  const canAddPerson =
    active.mode === 'AUDIO' &&
    activeParticipants.length < 3 &&
    typeof addParticipant === 'function';

  return (
    <>
      <div className="fixed inset-0 bg-black/90 z-40 flex items-center justify-center">
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Remote media */}
          <video
            ref={remoteRef}
            autoPlay
            playsInline
            className={`max-h-[80vh] ${isVideo ? '' : 'hidden'}`}
          />

          {/* Audio call UI */}
          {!isVideo && (
            <div className="flex flex-col items-center gap-4 text-white">
              <div className="text-xl text-center">
                Audio call
                {status ? ` — ${status}` : ''}
              </div>

              {activeParticipants.length > 0 && (
                <div className="bg-white/10 rounded-xl px-4 py-3 min-w-[280px]">
                  <div className="font-semibold mb-2">
                    Participants ({activeParticipants.length}/3)
                  </div>

                  <div className="space-y-2">
                    {activeParticipants.map((participant) => (
                      <div
                        key={participant.userId}
                        className="flex items-center justify-between"
                      >
                        <span>
                          {participant.user?.displayName ||
                            participant.user?.name ||
                            participant.user?.username ||
                            `User ${participant.userId}`}
                        </span>

                        <span className="text-sm text-white/70">
                          {participant.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Local video preview */}
          <video
            ref={localRef}
            autoPlay
            muted
            playsInline
            className={`absolute right-6 bottom-6 w-48 rounded-lg ${
              isVideo ? '' : 'hidden'
            }`}
          />

          {/* Add Person button */}
          {canAddPerson && (
            <button
              onClick={() => setAddOpen(true)}
              className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-full"
            >
              Add Person
            </button>
          )}

          {/* End Call button */}
          <button
            onClick={() => endCall('hangup')}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-red-600 hover:bg-red-700 text-white px-5 py-3 rounded-full"
          >
            End Call
          </button>
        </div>
      </div>

      <AddCallParticipantModal
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        currentUser={me}
        existingParticipantIds={existingParticipantIds}
        onAdd={addParticipant}
      />
    </>
  );
}