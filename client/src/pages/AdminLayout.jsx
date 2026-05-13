import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AppShell, ScrollArea, Title, Stack } from '@mantine/core';

export default function AdminLayout() {
  const { pathname } = useLocation();

  return (
    <AppShell navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <AppShell.Navbar p="md">
        <Title order={4} mb="md">
          Admin
        </Title>
        <ScrollArea.Autosize mah="calc(100vh - 140px)">
          <Stack gap="xs">
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                isActive || pathname.startsWith('/admin/users')
                  ? 'active'
                  : undefined
              }
            >
              Users
            </NavLink>
            <NavLink
              to="/admin/reports"
              className={({ isActive }) =>
                isActive || pathname.startsWith('/admin/reports')
                  ? 'active'
                  : undefined
              }
            >
              Reports
            </NavLink>
            <NavLink
              to="/admin/audit"
              className={({ isActive }) =>
                isActive || pathname.startsWith('/admin/audit')
                  ? 'active'
                  : undefined
              }
            >
              Audit Logs
            </NavLink>
          </Stack>
        </ScrollArea.Autosize>
      </AppShell.Navbar>

      <AppShell.Main>
        {needsKeyUnlock && (
          <Alert
            color="yellow"
            title="Encrypted messages locked"
            mb="md"
          >
            Your encrypted messages are locked on this device. You can still use settings,
            billing, help, and logout. Unlock or restore your key to continue messaging.
          </Alert>
        )}
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
