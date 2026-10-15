import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import {
  IconMicrophone,
  IconPlayerStop,
  IconLoader2,
} from '@tabler/icons-react';

import { toast } from '@/utils/toast';
import axiosClient from '@/api/axiosClient';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';

  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(type)) {
      return type;
    }
  }

  return '';
}

function extensionForMime(mimeType = '') {
  const type = mimeType.toLowerCase();

  if (type.includes('mp4')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

async function sha256OfFile(file) {
  if (!window.crypto?.subtle || !file.arrayBuffer) return null;

  const buf = await file.arrayBuffer();
  const hash = await window.crypto.subtle.digest('SHA-256', buf);

  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function MicButton({ onUploaded }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef(null);

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function releaseStream() {
    try {
      streamRef.current?.getTracks?.().forEach((track) => {
        track?.stop?.();
      });
    } catch (err) {
      console.error('Failed to release microphone stream', err);
    }

    streamRef.current = null;
  }

  async function uploadRecording(blob, mimeType, durationSec) {
    const extension = extensionForMime(mimeType);

    const file = new File(
      [blob],
      `voice-${Date.now()}.${extension}`,
      {
        type: mimeType || blob.type || 'audio/webm',
      }
    );

    const sha = await sha256OfFile(file).catch(() => null);

    // Same upload pipeline used by FileUploader.jsx
    const { data: intent } = await axiosClient.post(
      '/uploads/intent',
      {
        name: file.name,
        size: file.size,
        mimeType: file.type,
        sha256: sha,
      },
      {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      }
    );

    const {
      uploadUrl,
      key,
      publicUrl,
    } = intent || {};

    if (!uploadUrl || !key) {
      throw new Error('Invalid upload intent from server');
    }

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open('PUT', uploadUrl, true);

      xhr.setRequestHeader(
        'Content-Type',
        file.type || 'application/octet-stream'
      );

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(
            new Error(`Voice-note upload failed with status ${xhr.status}`)
          );
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error during voice-note upload'));
      };

      xhr.send(file);
    });

    const { data: complete } = await axiosClient.post(
      '/uploads/complete',
      {
        key,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        sha256: sha,
      },
      {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      }
    );

    const fileMeta = complete?.file;

    if (!fileMeta) {
      throw new Error('Upload completion did not return file metadata');
    }

    const url = fileMeta.url || publicUrl;

    if (!url) {
      throw new Error('Uploaded voice note has no URL');
    }

    const finalMeta = {
      key: fileMeta.key || key,
      url,
      name: fileMeta.name || file.name,
      mimeType:
        fileMeta.contentType ||
        fileMeta.mimeType ||
        file.type,
      contentType:
        fileMeta.contentType ||
        fileMeta.mimeType ||
        file.type,
      size: fileMeta.size || file.size,
      width: null,
      height: null,

      // Important: messages.js requires duration for AUDIO attachments.
      durationSec,

      thumbUrl: null,
      thumbnailUrl: null,
      kind: 'AUDIO',
    };

    onUploaded?.(finalMeta);
  }

  async function start() {
    if (busy || recording) return;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Audio recording is not supported in this browser');
      }

      if (typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorder is not supported in this browser');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = pickMimeType();

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error('MediaRecorder error', event);
        toast.err('Voice recording failed.');
      };

      recorder.onstop = async () => {
        stopTimer();

        const durationSec = Math.max(
          1,
          Math.round(
            (performance.now() - startTimeRef.current) / 1000
          )
        );

        const actualMimeType =
          recorder.mimeType ||
          mimeType ||
          'audio/webm';

        const blob = new Blob(
          chunksRef.current,
          { type: actualMimeType }
        );

        // Recorder has finished producing data.
        // It is safe to release the microphone now.
        releaseStream();

        try {
          setBusy(true);

          if (!blob.size) {
            throw new Error('Recorded voice note was empty');
          }

          await uploadRecording(
            blob,
            actualMimeType,
            durationSec
          );

          toast.ok('Voice note added.');
        } catch (err) {
          console.error('Voice-note upload failed', err);

          toast.err(
            err?.message ||
            'Failed to save voice recording.'
          );
        } finally {
          recorderRef.current = null;
          chunksRef.current = [];
          setBusy(false);
          setRecording(false);
          setElapsedSec(0);
        }
      };

      recorder.start(250);

      startTimeRef.current = performance.now();
      setElapsedSec(0);
      setRecording(true);

      timerRef.current = setInterval(() => {
        setElapsedSec(
          Math.floor(
            (performance.now() - startTimeRef.current) / 1000
          )
        );
      }, 250);
    } catch (err) {
      console.error('Failed to start voice recording', err);

      releaseStream();
      stopTimer();

      toast.err('Microphone permission is required.');

      setRecording(false);
      setBusy(false);
    }
  }

  function stop() {
    const recorder = recorderRef.current;

    if (
      !recorder ||
      recorder.state === 'inactive' ||
      busy
    ) {
      return;
    }

    // Let MediaRecorder flush its final audio chunk first.
    recorder.stop();
  }

  useEffect(() => {
    return () => {
      stopTimer();

      try {
        const recorder = recorderRef.current;

        if (
          recorder &&
          recorder.state !== 'inactive'
        ) {
          recorder.stop();
        }
      } catch {
        // Component is unmounting.
      }

      releaseStream();
    };
  }, []);

  if (recording) {
    return (
      <Group gap={6} wrap="nowrap">
        <Text
          size="xs"
          fw={600}
          c="red"
          style={{ whiteSpace: 'nowrap' }}
          aria-live="polite"
        >
          Recording {Math.floor(elapsedSec / 60)}:
          {String(elapsedSec % 60).padStart(2, '0')}
        </Text>

        <Tooltip
          label={
            busy
              ? 'Saving voice note'
              : 'Stop recording'
          }
        >
          <ActionIcon
            variant="filled"
            radius="md"
            onClick={stop}
            disabled={busy}
            aria-label={
              busy
                ? 'Saving voice note'
                : 'Stop recording'
            }
          >
            {busy ? (
              <IconLoader2
                size={18}
                className="spin"
              />
            ) : (
              <IconPlayerStop size={18} />
            )}
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  return (
    <Tooltip label="Record voice note">
      <ActionIcon
        variant="default"
        radius="md"
        onClick={start}
        disabled={busy}
        aria-label="Record voice note"
      >
        {busy ? (
          <IconLoader2
            size={18}
            className="spin"
          />
        ) : (
          <IconMicrophone size={18} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}