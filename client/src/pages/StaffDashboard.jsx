import { ScrollArea } from '@mantine/core';
import { useEffect, useState } from 'react';

import axiosClient from '../api/axiosClient';
import { DashboardButton } from '../components/admin/DashboardButton.jsx';
import {
  displayValue,
  dashboardError,
} from '../components/admin/dashboardFormatting.js';
import UserDetailsDialog from '../components/admin/UserDetailsDialog.jsx';

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
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [profile, setProfile] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [viewedUser, setViewedUser] = useState(null);
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
      .catch((failure) => {
        if (live)
          setError(
            dashboardError(
              failure,
              'Staff access requires a current MFA-verified session. Sign in again or contact your access administrator.'
            )
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
      .get(`/staff/${view}`, { params: { take: 25, skip: page * 25, ...(view === 'users' && query ? { query } : {}) } })
      .then(({ data }) => {
        if (live) {
          setResult(data);
          setError('');
        }
      })
      .catch((failure) => {
        if (live) {
          setSession(null);
          setError(
            dashboardError(
              failure,
              'Staff access is unavailable. Try again later.'
            )
          );
        }
      });
    return () => {
      live = false;
    };
  }, [view, page, message, query]);
  async function changeAccess(action) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const prefix = session.profile === 'FOUNDER' ? '/staff/founder' : '/staff';
      await axiosClient.post(`${prefix}/assignments/${target}/${action}`, {
        profile,
        reason,
      });
      setMessage(
        `Access ${action === 'grant' ? 'updated' : 'revoked'} for user ${target}. Existing sessions were invalidated when access changed.`
      );
      setReason('');
    } catch (failure) {
      setError(
        dashboardError(
          failure,
          'Access change failed. Refresh to verify the target and delegated scope before retrying.'
        )
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
    } catch (failure) {
      setError(
        dashboardError(
          failure,
          'Report could not be resolved. Refresh before retrying.'
        )
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="cf-dashboard">
      <h1>Staff dashboard</h1>
      {viewedUser && (
        <UserDetailsDialog
          userId={viewedUser}
          apiBase="/staff/users"
          onClose={() => setViewedUser(null)}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {!session && !error && <p role="status">Checking staff access…</p>}
      {session && (
        <>
          <p>Signed in as {session.profile.replaceAll('_', ' ')}</p>
          <nav aria-label="Staff sections" className="cf-dashboard-actions">
            {views
              .filter(([, , permission]) =>
                session.permissions.includes(permission)
              )
              .map(([key, label]) => (
                <DashboardButton
                  key={key}
                  onClick={() => {
                    setView(key);
                    setPage(0);
                  }}
                  primary={view === key}
                  aria-pressed={view === key}
                >
                  {label}
                </DashboardButton>
              ))}
          </nav>
          {message && <p role="status">{message}</p>}
          {view === 'assignments' &&
            session.permissions.includes('staff.assign') && (
              <form
                className="cf-dashboard-form"
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
                <div className="cf-dashboard-actions">
                  <DashboardButton primary disabled={busy} type="submit">
                    Grant or change access
                  </DashboardButton>
                  <DashboardButton
                    disabled={busy || !target || reason.trim().length < 5}
                    type="button"
                    onClick={() => changeAccess('revoke')}
                  >
                    Revoke access
                  </DashboardButton>
                </div>
              </form>
            )}
          {view === 'reports' &&
            session.permissions.includes('reports.resolve') && (
              <form className="cf-dashboard-form" onSubmit={resolveReport}>
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
                <DashboardButton primary disabled={busy} type="submit">
                  Resolve report
                </DashboardButton>
              </form>
            )}
          {view === 'users' && (
            <form className="cf-dashboard-form" onSubmit={(event) => {
              event.preventDefault();
              setPage(0);
              setQuery(search.trim());
            }}>
              <label>
                Search users by username or User ID
                <input type="search" maxLength={100} value={search}
                  onChange={(event) => setSearch(event.target.value)} />
              </label>
              <div className="cf-dashboard-actions">
                <DashboardButton primary type="submit">Search</DashboardButton>
                <DashboardButton type="button" onClick={() => {
                  setSearch(''); setQuery(''); setPage(0);
                }}>Clear</DashboardButton>
              </div>
            </form>
          )}
          {!result ? (
            <p role="status">Loading…</p>
          ) : (
            <>
              {result.items.length === 0 ? (
                <p style={{
                  width: 'fit-content',
                  maxWidth: '100%',
                  padding: '12px 16px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--mantine-radius-lg)',
                  background: 'var(--card)',
                  fontWeight: 600,
                }}>
                  {views.find(([key]) => key === view)?.[1]} — {result.total} records
                </p>
              ) : (
              <ScrollArea
                className="cf-dashboard-table-scroll"
                h="min(55dvh, 560px)"
                type="auto"
                viewportProps={{ tabIndex: 0, 'aria-label': 'Staff records' }}
              >
                <table className="cf-dashboard-table">
                  <caption>
                    {views.find(([key]) => key === view)?.[1]} — {result.total}{' '}
                    records
                  </caption>
                  <thead>
                    <tr>
                      {Object.keys(result.items[0] || {}).map((key) => (
                        <th key={key} scope="col">
                          {key === 'id'
                            ? 'ID'
                            : key === 'isBanned'
                              ? 'Banned'
                              : key
                                  .replace(/([a-z])([A-Z])/g, '$1 $2')
                                  .replace(/^./, (character) =>
                                    character.toUpperCase()
                                  )}
                        </th>
                      ))}
                      {view === 'users' && <th scope="col">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.id}>
                        {Object.entries(item).map(([key, value]) => (
                          <td key={key}>{displayValue(key, value)}</td>
                        ))}
                        {view === 'users' && (
                          <td>
                            <DashboardButton
                              onClick={() => setViewedUser(item.id)}
                            >
                              View
                            </DashboardButton>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
              )}
              {!result.items.length && <p>No records.</p>}
              <div className="cf-dashboard-actions" aria-label="Pagination">
                <DashboardButton
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </DashboardButton>
                <DashboardButton
                  disabled={(page + 1) * 25 >= result.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </DashboardButton>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
