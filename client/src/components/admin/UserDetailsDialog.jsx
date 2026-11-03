import { useEffect, useId, useRef, useState } from 'react';

import api from '../../api/axiosClient';

const fields = {
  displayName: 'Display name',
  preferredLanguage: 'Preferred language',
  showReadReceipts: 'Read receipts',
  showOriginalWithTranslation: 'Show original with translation',
};
const detailLabels = {
  id: 'ID',
  username: 'Username',
  role: 'Role',
  isBanned: 'Banned',
  ...fields,
};
export default function UserDetailsDialog({
  userId,
  apiBase = '/admin/users',
  mode = 'view',
  onClose,
  onSaved,
}) {
  const dialog = useRef(null),
    title = useId();
  const [details, setDetails] = useState(null),
    [values, setValues] = useState({});
  const [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    if (dialog.current.showModal) dialog.current.showModal();
    else dialog.current.setAttribute('open', '');
  }, []);
  useEffect(() => {
    let live = true;
    setDetails(null);
    setError('');
    setReason('');
    api
      .get(`${apiBase}/${userId}`)
      .then(({ data }) => {
        if (live) {
          setDetails(data);
          setValues(data.user);
        }
      })
      .catch((error) => {
        if (live)
          setError(
            error.response?.data?.error ||
              'User details unavailable. Verify your session and permissions.'
          );
      });
    return () => {
      live = false;
    };
  }, [apiBase, userId, reload]);
  const editable =
    details?.editableFields.filter((field) => Object.hasOwn(fields, field)) ||
    [];
  async function save(event) {
    event.preventDefault();
    if (reason.trim().length < 5) {
      setError('Enter a reason of at least 5 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const changes = Object.fromEntries(
        editable.map((field) => [field, values[field]])
      );
      const { data } = await api.patch(`${apiBase}/${userId}`, {
        changes,
        version: details.version,
        reason: reason.trim(),
      });
      onSaved?.(data.user);
      onClose();
    } catch (error) {
      if ([401, 403].includes(error.response?.status)) setDetails(null);
      setError(
        error.response?.data?.error ||
          'Unable to save user changes. No success was confirmed.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      style={{
        maxWidth: 'min(90vw, 640px)',
        maxHeight: '85vh',
        overflow: 'auto',
      }}
    >
      <h2 id={title}>
        {mode === 'edit' ? 'Edit user' : 'User details'} #{userId}
      </h2>
      {error && <p role="alert">{error}</p>}
      {!details && !error && <p role="status">Loading current values…</p>}
      {details && (
        <>
          <dl>
            {Object.entries(detailLabels).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {details.user[key] == null ? '—' : String(details.user[key])}
                </dd>
              </div>
            ))}
          </dl>
          {mode === 'edit' &&
            (editable.length ? (
              <form onSubmit={save}>
                {editable.map((field) => (
                  <label
                    key={field}
                    style={{ display: 'block', marginBlock: 12 }}
                  >
                    {fields[field]}{' '}
                    {typeof values[field] === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={values[field]}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            [field]: event.target.checked,
                          })
                        }
                      />
                    ) : (
                      <input
                        value={values[field] || ''}
                        maxLength={field === 'displayName' ? 100 : 35}
                        required={field === 'preferredLanguage'}
                        onChange={(event) =>
                          setValues({ ...values, [field]: event.target.value })
                        }
                      />
                    )}
                  </label>
                ))}
                <label style={{ display: 'block' }}>
                  Change reason{' '}
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Save changes
                </button>
              </form>
            ) : (
              <p>
                This identity is protected or your permission is read-only.
                Editing is unavailable.
              </p>
            ))}
        </>
      )}
      {error && (
        <button disabled={busy} onClick={() => setReload(reload + 1)}>
          Reload current values
        </button>
      )}
      <button type="button" disabled={busy} onClick={onClose}>
        {mode === 'edit' ? 'Cancel' : 'Close'}
      </button>
    </dialog>
  );
}
