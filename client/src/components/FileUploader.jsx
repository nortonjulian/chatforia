import { useState } from 'react';
import axiosClient from '../api/axiosClient';

export default function FileUploader({ onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      const fd = new FormData();
      fd.append('file', file); // field name must be "file"

      const res = await axiosClient.post('/media/upload', fd, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-Requested-With': 'XMLHttpRequest', // matches server's CSRF check
        },
        onUploadProgress: (evt) => {
          // optional: progress UI
          // const pct = Math.round((evt.loaded / (evt.total || 1)) * 100);
        },
      });

      // res.data -> { ok, key, url, contentType, size }
      onUploaded?.(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = ''; // allow re-selecting same file
    }
  }

  return (
    <div>
      <label>
        <input
          aria-label="Choose file"
          type="file"
          onChange={handleChange}
          disabled={uploading}
          // optional: accept to guide users (server still enforces MIME)
          accept="image/*,audio/*,video/mp4,video/webm,application/pdf"
          style={{ display: 'none' }}
        />
        <button type="button" disabled={uploading}>
          {uploading ? 'Uploading…' : 'Choose file'}
        </button>
      </label>

      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
