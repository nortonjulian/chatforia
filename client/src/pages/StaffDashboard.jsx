import { useEffect, useState } from 'react';

import axiosClient from '../api/axiosClient';

const views = [
  ['users', 'Users', 'users.read'],
  ['reports', 'Reports', 'reports.read'],
  ['assignments', 'Staff access', 'staff.read'],
  ['audit', 'Access audit', 'audit.read'],
];

export default function StaffDashboard() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState('');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [profile, setProfile] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    axiosClient
      .get('/staff/session')
      .then(({ data }) => {
        if (!live) return;
        setSession(data);
        setProfile(data.delegatableProfiles[0] || '');
        setView(
          views.find(([, , permission]) =>
            data.permissions.includes(permission)
          )?.[0] || ''
        );
      })
      .catch(() => {
        if (live)
          setError(
            'Staff access requires a current MFA-verified session. Sign in again or contact your access administrator.'
          );
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!view) return undefined;
    let live = true;
    setResult(null);
    axiosClient
      .get(`/staff/${view}`, { params: { take: 25, skip: page * 25 } })
      .then(({ data }) => {
        if (live) {
          setResult(data);
          setError('');
        }
      })
      .catch(() => {
        if (live) {
          setSession(null);
          setError('Staff access is unavailable. Refresh and sign in again.');
        }
      });
    return () => {
      live = false;
    };
  }, [view, page, message]);
  async function changeAccess(action) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await axiosClient.post(`/staff/assignments/${target}/${action}`, {
        profile,
        reason,
      });
      setMessage(
        `Access ${action === 'grant' ? 'updated' : 'revoked'} for user ${target}. Existing sessions were invalidated when access changed.`
      );
      setReason('');
    } catch {
      setError(
        'Access change failed. Refresh to verify your session, target and delegated scope before retrying.'
      );
    } finally {
      setBusy(false);
    }
  }
  async function resolveReport(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { data } = await axiosClient.post(
        `/staff/reports/${target}/resolve`,
        { reason }
      );
      setMessage(
        data.changed
          ? `Report ${target} resolved.`
          : 'Report was already resolved or is unavailable.'
      );
      setReason('');
    } catch {
      setError(
        'Report could not be resolved. Refresh and verify your session before retrying.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: '1.5rem', maxWidth: 1100, margin: 'auto' }}>
      <h1>Staff dashboard</h1>
      {error && <p role="alert">{error}</p>}
      {!session && !error && <p role="status">Checking staff access…</p>}
      {session && (
        <>
          <p>Signed in as {session.profile.replaceAll('_', ' ')}</p>
          <nav aria-label="Staff sections">
            {views
              .filter(([, , permission]) =>
                session.permissions.includes(permission)
              )
              .map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setView(key);
                    setPage(0);
                  }}
                  aria-pressed={view === key}
                >
                  {label}
                </button>
              ))}
          </nav>
          {message && <p role="status">{message}</p>}
          {view === 'assignments' &&
            session.permissions.includes('staff.assign') && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  changeAccess('grant');
                }}
              >
                <h2>Manage staff access</h2>
                <label>
                  User ID{' '}
                  <input
                    type="number"
                    min="1"
                    max="2147483647"
                    required
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  />
                </label>
                <label>
                  Profile{' '}
                  <select
                    required
                    value={profile}
                    onChange={(event) => setProfile(event.target.value)}
                  >
                    {session.delegatableProfiles.map((value) => (
                      <option key={value} value={value}>
                        {value.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reason{' '}
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button disabled={busy} type="submit">
                  Grant or change access
                </button>
                <button
                  disabled={busy || !target || reason.trim().length < 5}
                  type="button"
                  onClick={() => changeAccess('revoke')}
                >
                  Revoke access
                </button>
              </form>
            )}
          {view === 'reports' &&
            session.permissions.includes('reports.resolve') && (
              <form onSubmit={resolveReport}>
                <h2>Resolve report</h2>
                <label>
                  Report ID{' '}
                  <input
                    type="number"
                    min="1"
                    max="2147483647"
                    required
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  />
                </label>
                <label>
                  Resolution reason{' '}
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button disabled={busy} type="submit">
                  Resolve report
                </button>
              </form>
            )}
          {!result ? (
            <p role="status">Loading…</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <caption>
                    {views.find(([key]) => key === view)?.[1]} — {result.total}{' '}
                    records
                  </caption>
                  <thead>
                    <tr>
                      {Object.keys(result.items[0] || {}).map((key) => (
                        <th key={key} scope="col">
                          {key.replace(/([a-z])([A-Z])/g, '$1 $2')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.id}>
                        {Object.entries(item).map(([key, value]) => (
                          <td key={key}>
                            {value == null ? '—' : String(value)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!result.items.length && <p>No records.</p>}
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button
                disabled={(page + 1) * 25 >= result.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </>
          )}
        </>
      )}
    </main>
  );
}
