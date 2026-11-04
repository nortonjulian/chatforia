import { Checkbox, TextInput, Textarea } from '@mantine/core';
import { useEffect, useId, useRef, useState } from 'react';

import api from '../../api/axiosClient';

import { DashboardButton } from './DashboardButton.jsx';
import { dashboardError, displayValue } from './dashboardFormatting.js';

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
  onPermissions,
}) {
  const permissionsCallback = useRef(onPermissions);
  permissionsCallback.current = onPermissions;
  const dialog = useRef(null),
    title = useId(),
    formId = useId();
  const [details, setDetails] = useState(null),
    [values, setValues] = useState({});
  const [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const modal = dialog.current;
    const opener = document.activeElement;
    if (modal.showModal) modal.showModal();
    else modal.setAttribute('open', '');
    return () => {
      if (modal.open && typeof modal.close === 'function') modal.close();
      // React removes the dialog on save/cancel. Native removal alone does not
      // restore focus as dialog.close() does; preserve the invoking control.
      if (opener instanceof HTMLElement && opener.isConnected)
        (opener.disabled
          ? opener
              .closest('[data-user-id]')
              ?.querySelector('button:not(:disabled)')
          : opener
        )?.focus();
    };
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
          permissionsCallback.current?.(userId, data.editableFields || []);
        }
      })
      .catch((error) => {
        if (live && [401, 403].includes(error.response?.status))
          permissionsCallback.current?.(userId, []);
        if (live)
          setError(
            dashboardError(error, 'User details unavailable. Try again later.')
          );
      });
    return () => {
      live = false;
    };
  }, [apiBase, userId, reload]);
  const editable =
    details?.editableFields?.filter((field) => Object.hasOwn(fields, field)) ||
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
      if ([401, 403].includes(error.response?.status)) {
        setDetails(null);
        permissionsCallback.current?.(userId, []);
      }
      setError(
        dashboardError(
          error,
          'Unable to save user changes. No success was confirmed.'
        )
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [
          ...dialog.current.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]'
          ),
        ].filter((node) => node.tabIndex >= 0 && !node.hidden);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          dialog.current.focus();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="cf-user-dialog"
    >
      <h2 id={title}>
        {mode === 'edit' ? 'Edit user' : 'User details'} #{userId}
      </h2>
      {error && <p role="alert">{error}</p>}
      {!details && !error && <p role="status">Loading current values…</p>}
      {details && (
        <>
          <dl className="cf-user-details">
            {Object.entries(detailLabels)
              .filter(([key]) => mode !== 'edit' || !editable.includes(key))
              .map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{displayValue(key, details.user[key])}</dd>
                </div>
              ))}
          </dl>
          {mode === 'edit' &&
            (editable.length ? (
              <form id={formId} className="cf-dashboard-form" onSubmit={save}>
                {editable.map((field) =>
                  typeof values[field] === 'boolean' ? (
                    <Checkbox
                      key={field}
                      label={fields[field]}
                      checked={values[field]}
                      disabled={busy}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          [field]: event.currentTarget.checked,
                        })
                      }
                    />
                  ) : (
                    <TextInput
                      key={field}
                      label={fields[field]}
                      value={values[field] || ''}
                      disabled={busy}
                      maxLength={field === 'displayName' ? 100 : 35}
                      required={field === 'preferredLanguage'}
                      withAsterisk={false}
                      description={
                        field === 'preferredLanguage'
                          ? displayValue(field, values[field])
                          : undefined
                      }
                      onChange={(event) =>
                        setValues({
                          ...values,
                          [field]: event.currentTarget.value,
                        })
                      }
                    />
                  )
                )}
                <Textarea
                  label="Change reason"
                  required
                  withAsterisk={false}
                  minLength={5}
                  maxLength={500}
                  description="Explain why these preferences are changing."
                  autosize
                  minRows={3}
                  disabled={busy}
                  value={reason}
                  onChange={(event) => setReason(event.currentTarget.value)}
                />
              </form>
            ) : (
              <p>
                This identity is protected or your permission is read-only.
                Editing is unavailable.
              </p>
            ))}
        </>
      )}
      <div className="cf-dashboard-actions">
        {error && (
          <DashboardButton
            disabled={busy}
            onClick={() => setReload(reload + 1)}
          >
            Reload current values
          </DashboardButton>
        )}
        <DashboardButton type="button" disabled={busy} onClick={onClose}>
          {mode === 'edit' ? 'Cancel' : 'Close'}
        </DashboardButton>
        {mode === 'edit' && editable.length > 0 && (
          <DashboardButton primary type="submit" form={formId} disabled={busy}>
            Save changes
          </DashboardButton>
        )}
      </div>
    </dialog>
  );
}
