import { useRef, useState } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconMicrophone, IconPlayerStop, IconLoader2 } from '@tabler/icons-react';
import { toast } from '@/utils/toast';
import axiosClient from '@/api/axiosClient';

// Utility: convert Blob to File
function blobToFile(blob, name) {
  return new File([blob], name, { type: blob.type });
}

export default function MicButton({ chatRoomId, onUploaded, onSent }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(0);

  // Handle recorder stop: build blob, upload, fire callback
  function handleStopped(rec) {
    // Enter "uploading" state – keep Stop button visible & disabled
    setBusy(true);

    const mimeType = rec.mimeType || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });

    const durationSec = Math.max(
      1,
      Math.round((performance.now() - startTimeRef.current) / 1000)
    );

    const file = blobToFile(blob, `voice-${Date.now()}.webm`);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'audio');

    // Fire-and-forget upload: don't `await` so the "busy" UI lives
    const uploadPromise = axiosClient.post('/files/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    uploadPromise
      .then(({ data }) => {
        const fileMeta = {
          url: data.url,
          contentType: data.contentType || mimeType,
          durationSec,
          caption: null,
        };
        onUploaded?.(fileMeta);

        // Optional: auto-send audio message
        // if (chatRoomId && onSent) {
        //   const payload = {
        //     chatRoomId: String(chatRoomId),
        //     attachmentsInline: [
        //       {
        //         kind: 'AUDIO',
        //         url: fileMeta.url,
        //         mimeType: fileMeta.contentType,
        //         durationSec,
        //       },
        //     ],
        //   };
        //   axiosClient.post('/messages', payload).then(({ data: saved }) => {
        //     onSent(saved);
        //   });
        // }
      })
      .catch((e) => {
        console.error(e);
        toast.err('Failed to save recording.');
      })
      .finally(() => {
        // After upload finishes (success or error), go back to idle/record UI
        setBusy(false);
        setRecording(false);
      });
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };

      rec.onstop = () => {
        // When recorder stops, kick off upload flow
        handleStopped(rec);
      };

      rec.start(100);
      startTimeRef.current = performance.now();
      recRef.current = rec;
      setRecording(true);
      setBusy(false);
    } catch (err) {
      console.error(err);
      toast.err('Microphone permission is required.');
    }
  }

  function stop() {
    const rec = recRef.current;
    if (!rec || rec.state === 'inactive') {
      return;
    }

    recRef.current = null;

    // Stop all audio tracks safely (handles test mock shape)
    try {
      const stream = rec.stream;
      if (stream && typeof stream.getTracks === 'function') {
        const tracks = stream.getTracks();
        if (Array.isArray(tracks)) {
          tracks.forEach((t) => t && typeof t.stop === 'function' && t.stop());
        }
      }
    } catch (e) {
      console.error('Error stopping tracks', e);
    }

    // This will synchronously trigger rec.onstop in the test mock,
    // which will call handleStopped(rec) and set busy=true + keep recording=true
    rec.stop();
  }

  const disabled = busy;

  return recording ? (
    <Tooltip label="Stop recording">
      <ActionIcon
        variant="filled"
        radius="md"
        onClick={stop}
        disabled={disabled}
        aria-label="Stop"
      >
        {busy ? <IconLoader2 size={18} className="spin" /> : <IconPlayerStop size={18} />}
      </ActionIcon>
    </Tooltip>
  ) : (
    <Tooltip label="Record voice note">
      <ActionIcon
        variant="default"
        radius="md"
        onClick={start}
        disabled={disabled}
        aria-label="Record voice note"
      >
        <IconMicrophone size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
