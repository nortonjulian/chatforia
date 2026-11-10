import { ScrollArea } from '@mantine/core';
import { useEffect, useState } from 'react';

import api from '../../api/axiosClient';

import { DashboardButton } from './DashboardButton.jsx';
import { dashboardError, displayValue } from './dashboardFormatting.js';
import UserDetailsDialog from './UserDetailsDialog.jsx';
function normalizeUsers(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.users)) return payload.users;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  return payload.data ? normalizeUsers(payload.data) : [];
}
export default function UsersTable() {
  const [users, setUsers] = useState([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null),
    [permissions, setPermissions] = useState({});
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    api
      .get('/admin/users', { params: { query, take: 25, skip: 0 } })
      .then(({ data }) => {
        if (alive) {
          const records = normalizeUsers(data);
          setUsers(records);
          setPermissions(
            Object.fromEntries(
              records.map((user) => [
                user.id,
                Array.isArray(user.editableFields) ? user.editableFields : [],
              ])
            )
          );
        }
      })
      .catch((error) => {
        if (alive) {
          setUsers([]);
          setLoadError(
            dashboardError(
              error,
              'Unable to load users. Please try again later.'
            )
          );
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [query]);
  return (
    <section className="cf-dashboard" data-testid="card">
      <h1>Users</h1>
      <p>View account details and manage permitted preferences.</p>
      <form className="cf-dashboard-form" onSubmit={(event) => {
        event.preventDefault();
        setQuery(search.trim());
      }}>
        <label>
          Search users by username or email
          <input type="search" maxLength={100} value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Enter a username or email" />
        </label>
        <div className="cf-dashboard-actions">
          <DashboardButton primary type="submit">Search</DashboardButton>
          <DashboardButton type="button" onClick={() => {
            setSearch('');
            setQuery('');
          }}>Clear</DashboardButton>
        </div>
      </form>
      <p>Showing up to 25 results. Refine your search to find a specific account.</p>
      {selected && (
        <UserDetailsDialog
          userId={selected.id}
          mode={selected.mode}
          onClose={() => setSelected(null)}
          onPermissions={(id, fields) =>
            setPermissions((current) => ({ ...current, [id]: fields }))
          }
          onSaved={(updated) =>
            setUsers((current) =>
              current.map((user) =>
                user.id === updated.id ? { ...user, ...updated } : user
              )
            )
          }
        />
      )}
      {loading ? (
        <p role="status">Loading…</p>
      ) : loadError ? (
        <p role="alert">{loadError}</p>
      ) : users.length === 0 ? (
        <p>No users found.</p>
      ) : (
        <ScrollArea
          className="cf-dashboard-table-scroll"
          viewportProps={{ tabIndex: 0, 'aria-label': 'User records' }}
        >
          <table className="cf-dashboard-table">
            <thead>
              <tr>
                <th scope="col">User ID</th>
                <th scope="col">Account</th>
                <th scope="col">Display name</th>
                <th scope="col">Role</th>
                <th scope="col">Banned</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  data-user-id={user.id}
                  aria-label={`User ${user.id}`}
                >
                  <td>{user.id}</td>
                  <td>{user.username ?? `User #${user.id}`}</td>
                  <td>{displayValue('displayName', user.displayName)}</td>
                  <td>{user.role}</td>
                  <td>{displayValue('isBanned', user.isBanned)}</td>
                  <td>
                    <div className="cf-dashboard-actions">
                      <DashboardButton
                        onClick={() =>
                          setSelected({ id: user.id, mode: 'view' })
                        }
                      >
                        View
                      </DashboardButton>
                      <DashboardButton
                        primary
                        disabled={!permissions[user.id]?.length}
                        title={
                          !permissions[user.id]?.length
                            ? 'Editing is unavailable for this identity.'
                            : undefined
                        }
                        onClick={() =>
                          setSelected({ id: user.id, mode: 'edit' })
                        }
                      >
                        Edit
                      </DashboardButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </section>
  );
}
