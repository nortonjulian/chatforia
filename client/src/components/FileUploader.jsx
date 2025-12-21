import { useRef, useState } from 'react';
import axiosClient from '../api/axiosClient';

export default function FileUploader({ onUploaded, onError, button }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  async function handleChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await axiosClient.post('/media/upload', fd, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      onUploaded?.(res.data);
    } catch (err) {
      const msg = err?.response?.data?.error || 'Upload failed';
      setError(msg);
      onError?.(msg);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  const trigger = button ? (
    <span
      onClick={() => !uploading && inputRef.current?.click()}
      style={{ display: 'inline-flex' }}
    >
      {button}
    </span>
  ) : (
    <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>
      {uploading ? 'Uploading…' : 'Choose file'}
    </button>
  );

  return (
    <div>
      <input
        ref={inputRef}
        aria-label="Choose file"
        type="file"
        onChange={handleChange}
        disabled={uploading}
        accept="image/*,audio/*,video/mp4,video/webm,application/pdf"
        style={{ display: 'none' }}
      />

      {trigger}

      {/* Only show inline error UI if no onError handler is provided */}
      {error && !onError && (
        <p role="alert" style={{ color: 'red' }}>
          {error}
        </p>
      )}
    </div>
  );
}
