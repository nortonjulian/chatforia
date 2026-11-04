import { Button } from '@mantine/core';
import './dashboard.css';

export function DashboardButton({ primary = false, ...props }) {
  return (
    <Button
      radius="xl"
      size="sm"
      px="md"
      variant={primary ? 'filled' : 'outline'}
      className="cf-dashboard-button"
      styles={{
        root: {
          background: primary
            ? 'linear-gradient(90deg, var(--brand-amber), var(--brand-orange))'
            : 'transparent',
          color: primary ? 'var(--mantine-color-black)' : 'var(--fg)',
          border: `1px solid ${primary ? 'transparent' : 'var(--border)'}`,
          boxShadow: 'none',
        },
      }}
      {...props}
    />
  );
}
