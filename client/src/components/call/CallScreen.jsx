import { useEffect, useRef } from 'react';
import { useCall } from '../../context/CallContext';

export default function CallScreen() {
  const { active, status, localStream, remoteStream, endCall } = useCall();
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

  return (
    <div className="fixed inset-0 bg-black/90 z-40 flex items-center justify-center">
      <div className="relative w-full h-full flex items-center justify-center">
        <video ref={remoteRef} autoPlay playsInline className={`max-h-[80vh] ${isVideo ? '' : 'hidden'}`} />
        {!isVideo && (
          <div className="text-white text-xl">Audio call with User {active.peerUser?.id} — {status}</div>
        )}
        <video ref={localRef} autoPlay muted playsInline className={`absolute right-6 bottom-6 w-48 rounded-lg ${isVideo ? '' : 'hidden'}`} />
        <button onClick={endCall} className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white px-5 py-3 rounded-full">
          End Call
        </button>
      </div>
    </div>
  );
}
