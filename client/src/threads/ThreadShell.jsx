import { Box } from '@mantine/core';

export default function ThreadShell({ header, children, composer }) {
  return (
    <Box
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {header ? <Box style={{ flex: '0 0 auto' }}>{header}</Box> : null}

      <Box
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </Box>

      {composer ? (
        <Box
          style={{
            flex: '0 0 auto',
            padding: '8px 12px',
            borderTop: '1px solid rgba(0,0,0,0.06)',
            background: 'var(--mantine-color-body)',
            position: 'relative',
            zIndex: 2,
          }}
        >
          {composer}
        </Box>
      ) : null}
    </Box>
  );
}