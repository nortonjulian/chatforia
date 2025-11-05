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

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data?.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        setBusy(true);
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          // compute duration on client
          const durationSec = Math.max(1, Math.round((performance.now() - startTimeRef.current) / 1000));

          // upload to your existing file endpoint (assuming FileUploader uses /files/upload)
          const file = blobToFile(blob, `voice-${Date.now()}.webm`);
          const fd = new FormData();
          fd.append('file', file);
          fd.append('kind', 'audio');

          const { data } = await axiosClient.post('/files/upload', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });

          // Expecting data like { url, contentType } from your uploader
          const fileMeta = {
            url: data.url,
            contentType: data.contentType || 'audio/webm',
            durationSec,
            caption: null,
          };
          onUploaded?.(fileMeta);

          // (Optional) directly send a message with just this audio
          // If you want this convenience:
          // const payload = {
          //   chatRoomId: String(chatRoomId),
          //   attachmentsInline: [{
          //     kind: 'AUDIO',
         //     url: fileMeta.url,
         //     mimeType: fileMeta.contentType,
         //     durationSec
          //   }]
          // };
          // const { data: saved } = await axiosClient.post('/messages', payload);
          // onSent?.(saved);
        } catch (e) {
          console.error(e);
          toast.err('Failed to save recording.');
        } finally {
          setBusy(false);
        }
      };

      rec.start(100);
      startTimeRef.current = performance.now();
      recRef.current = rec;
      setRecording(true);
    } catch (err) {
      console.error(err);
      toast.err('Microphone permission is required.');
    }
  }

  function stop() {
    setRecording(false);
    const rec = recRef.current;
    recRef.current = null;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
      // stop all tracks
      rec.stream?.getTracks?.().forEach((t) => t.stop());
    }
  }

  const disabled = busy;

  return recording ? (
    <Tooltip label="Stop recording">
      <ActionIcon variant="filled" radius="md" onClick={stop} disabled={disabled} aria-label="Stop">
        {busy ? <IconLoader2 size={18} className="spin" /> : <IconPlayerStop size={18} />}
      </ActionIcon>
    </Tooltip>
  ) : (
    <Tooltip label="Record voice note">
      <ActionIcon variant="default" radius="md" onClick={start} disabled={disabled} aria-label="Record voice note">
        <IconMicrophone size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
