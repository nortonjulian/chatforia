import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import { ActionIcon } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { toast } from '../utils/toast';

/**
 * FileUploader
 *
 * Props:
 * - button: ReactNode to use as the click target (optional)
 * - onUploaded(fileMeta)  // called when upload complete with canonical fileMeta
 * - onError(message)
 *
 * Flow:
 * 1) POST /uploads/intent { name, size, mimeType, sha256? } -> { uploadUrl, key, expiresIn, publicUrl }
 * 2) PUT file to uploadUrl (shows progress)
 * 3) POST /uploads/complete { key, name, mimeType, size, width?, height? }
 * 4) call onUploaded(fileMeta)
 */
export default function FileUploader({ button, onUploaded, onError }) {
  const inputRef = useRef();

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    const f = files[0];

    // small helper: compute SHA-256 if you want dedupe (optional)
    async function sha256OfFile(file) {
      if (!window.crypto || !file.arrayBuffer) return null;
      const buf = await file.arrayBuffer();
      const hash = await window.crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
    }

    try {
      const sha = await sha256OfFile(f).catch(() => null);

      // 1) request intent
      const intentRes = await fetch('/uploads/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, size: f.size, mimeType: f.type, sha256: sha }),
      });

      if (!intentRes.ok) {
        const body = await intentRes.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create upload intent');
      }
      const intent = await intentRes.json();

      const { uploadUrl, key, publicUrl } = intent;

      if (!uploadUrl || !key) throw new Error('Invalid upload intent from server');

      // 2) PUT file to uploadUrl with progress
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', f.type || 'application/octet-stream');

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            // optional: expose progress via UI/state if desired
            // toast.info(`Upload ${pct}%`);
          }
        };

        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(f);
      });

      // 3) notify server upload is complete
      const completeRes = await fetch('/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          name: f.name,
          mimeType: f.type,
          size: f.size,
        }),
      });

      if (!completeRes.ok) {
        const body = await completeRes.json().catch(() => ({}));
        throw new Error(body.error || 'Upload complete failed');
      }
      const complete = await completeRes.json();
      const fileMeta = complete.file;

      // If publicUrl was provided earlier, prefer it
      if (publicUrl && !fileMeta.url) fileMeta.url = publicUrl;

      // Ensure returned meta contains expected fields
      const finalMeta = {
        key: fileMeta.key,
        url: fileMeta.url,
        name: fileMeta.name || f.name,
        contentType: fileMeta.contentType || f.type,
        size: fileMeta.size || f.size,
        width: fileMeta.width || null,
        height: fileMeta.height || null,
        durationSec: fileMeta.durationSec || null,
        thumbUrl: fileMeta.thumbUrl || null,
      };

      onUploaded?.(finalMeta);
      toast.ok('File uploaded.');
    } catch (err) {
      console.error('FileUploader error', err);
      onError?.(err.message || 'Upload failed');
      toast.err(err.message || 'Upload failed');
    } finally {
      // reset input so same file can be picked again
      if (inputRef.current) {
        inputRef.current.value = null;
      }
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <span onClick={handleClick} style={{ display: 'inline-block', cursor: 'pointer' }}>
        {button || (
          <ActionIcon variant="default" title="Upload file">
            <IconUpload />
          </ActionIcon>
        )}
      </span>
    </>
  );
}

FileUploader.propTypes = {
  button: PropTypes.node,
  onUploaded: PropTypes.func,
  onError: PropTypes.func,
};