import { Box } from '@mantine/core';

/**
 * Visual wrapper that gives a consistent “SMS-style” composer area
 * while allowing different input engines (MessageInput, BottomComposer, etc.)
 */
export default function ThreadComposerFrame({ topRow, children }) {
  return (
    <Box
      style={{
        borderTop: '1px solid rgba(0,0,0,0.06)',
        background: 'var(--mantine-color-body)',
        padding: 10,
      }}
    >
      {topRow ? <Box mb={8}>{topRow}</Box> : null}

      <Box
        style={{
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 14,
          padding: 10,
          background: 'rgba(255,255,255,0.6)',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
