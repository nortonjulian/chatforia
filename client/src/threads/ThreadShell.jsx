import { Box } from '@mantine/core';

export default function ThreadShell({ header, children, composer }) {
  return (
    <Box style={{ height: '100dvh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {header ? <Box style={{ flex: '0 0 auto' }}>{header}</Box> : null}

      {/* ✅ Content area: should be the only scrollable region in most screens */}
      <Box
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {children}
      </Box>

      {/* ✅ Sticky composer: pins to bottom of viewport even if parent isn't full-height */}
      <Box
        style={{
            flex: '0 0 auto',
            padding: 12,
            borderTop: '1px solid rgba(0,0,0,0.06)',
            background: 'var(--mantine-color-body)',

            // ✅ NEW: anchor any absolute/sticky elements inside BottomComposer
            position: 'relative',
            zIndex: 2,
        }}
        >
        {composer}
        </Box>
    </Box>
  );
}
