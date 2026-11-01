import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ScrollArea, Title, Stack } from '@mantine/core';
import './AdminLayout.css';
import Footer from '@/components/footer/Footer.jsx';

export default function AdminLayout() {
  const { pathname } = useLocation();

  return (
    <div className="cf-admin-container">
      <div className="cf-admin-layout">
        <aside className="cf-admin-layout__nav" aria-label="Administrator navigation">
          <Title order={4} mb="md">
            Admin
          </Title>
          <ScrollArea.Autosize className="cf-admin-layout__scroll" mah="calc(100vh - 140px)">
            <Stack gap="xs" className="cf-admin-layout__links">
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
                to="/admin/support"
                className={({ isActive }) =>
                  isActive || pathname.startsWith("/admin/support") ? "active" : undefined
                }
              >
                Support
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
        </aside>

        <main className="cf-admin-layout__main">
          <div className="cf-admin-layout__content">
            <Outlet />
          </div>
          <Footer />
        </main>
      </div>
    </div>
  );
}
