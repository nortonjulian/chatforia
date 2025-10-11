import { Box } from '@mantine/core';

export const CONTENT_MAX = 720;  // chat column
export const CARD_MAX    = 320;  // small/native/promo card
export const BANNER_MAX  = 728;  // banner formats

export function CardAdWrap({ children, align='center' }) {
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  return (
    <Box
      style={{
        display: 'flex',
        justifyContent: justify,
        // DO NOT let this be 100vw; keep it at the chat column width.
        maxWidth: CONTENT_MAX,
        margin: '0 auto',
        padding: 0,
      }}
    >
      <Box style={{ maxWidth: CARD_MAX, width: '100%' }}>
        {children}
      </Box>
    </Box>
  );
}

export function BannerAdWrap({ children, align='center' }) {
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  return (
    <Box
      style={{
        display: 'flex',
        justifyContent: justify,
        maxWidth: CONTENT_MAX,
        margin: '0 auto',
        padding: 0,
      }}
    >
      <Box style={{ maxWidth: BANNER_MAX, width: '100%' }}>
        {children}
      </Box>
    </Box>
  );
}
