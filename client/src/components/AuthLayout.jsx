import { Outlet, Link } from 'react-router-dom';
import {
  Container,
  Grid,
  Stack,
  Title,
  Text,
  Image as MantineImage,
  ThemeIcon,
  List,
  Anchor,
  Group,
  Button,
  Paper,
  Divider,
} from '@mantine/core';
import { Lock, Globe, MessageCircle, ShieldCheck } from 'lucide-react';
import LogoGlyph from '@/components/LogoGlyph';

// Smart links
const APP_GENERIC = 'https://go.chatforia.com/app';
const APP_IOS     = 'https://go.chatforia.com/ios';
const APP_ANDROID = 'https://go.chatforia.com/android';

/* ---------- BRAND LOCKUP ---------- */
function LogoLockup({ size = 64, titleOrder = 4, className }) {
  return (
    <Group
      gap="xs"
      align="center"
      wrap="nowrap"
      className={`brand-lockup ${className || ''}`}
      style={{ '--logo-size': `${size}px` }}
    >
      {/* NOTE: use a fresh class to avoid legacy CSS that set fill:none */}
      <LogoGlyph className="brand-logo" size={size} />
      <Title
        order={titleOrder}
        className="brand-lockup__name brand-lockup__name--solid"
        style={{ margin: 0 }}
      >
        Chatforia
      </Title>
    </Group>
  );
}

/* ---------- Mobile-only brand bar ---------- */
function MobileTopBar() {
  return (
    <Group hiddenFrom="md" gap="xs" align="center" wrap="nowrap" py="sm">
      <LogoLockup size={32} titleOrder={4} />
    </Group>
  );
}

/* ---------- “Get the app” card ---------- */
function GetAppCard() {
  const BADGE_H = 'clamp(52px, 6vw, 72px)';
  const QR_SIZE = 'calc(1.1 * (clamp(52px, 6vw, 72px)))';

  return (
    <Paper withBorder shadow="xs" radius="xl" p="md">
      <Divider mb="md" label="Get the app" />
      <Group justify="space-between" wrap="nowrap" align="center">
        {/* QR: show on tablet/desktop */}
        <Group gap="sm" align="center" visibleFrom="sm">
          <Anchor
            href={APP_GENERIC}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the download link"
            style={{ display: 'inline-flex', padding: 6, borderRadius: 12 }}
          >
            <MantineImage
              src="/qr-chatforia.png"
              alt="Scan to get Chatforia"
              h={QR_SIZE}
              w={QR_SIZE}
              radius="md"
              onError={(e) => {
                e.currentTarget.src =
                  `https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(APP_GENERIC)}`;
              }}
            />
          </Anchor>
          <Text size="sm" style={{ color: 'var(--fg)', opacity: 0.85 }} maw={240}>
            On desktop? Scan with your phone to get the app.
          </Text>
        </Group>

        {/* Badges */}
        <Stack gap="sm" align="stretch" style={{ minWidth: 260 }}>
          <Anchor
            href={APP_IOS}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download on the App Store"
            title="Download on the App Store"
            style={{ display: 'inline-flex', padding: 6, borderRadius: 12 }}
          >
            <MantineImage
              src="/badges/app-store-badge.png"
              h={BADGE_H}
              fit="contain"
              alt="Download on the App Store"
              style={{ width: 'auto' }}
            />
          </Anchor>
          <Anchor
            href={APP_ANDROID}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Get it on Google Play"
            title="Get it on Google Play"
            style={{ display: 'inline-flex', padding: 6, borderRadius: 12 }}
          >
            <MantineImage
              src="/badges/google-play-badge.png"
              h={BADGE_H}
              fit="contain"
              alt="Get it on Google Play"
              style={{ width: 'auto' }}
            />
          </Anchor>
        </Stack>
      </Group>
    </Paper>
  );
}

/* ---------- Layout ---------- */
export default function AuthLayout() {
  return (
    <div className="auth-page">
      <Container size="lg" py="xl">
        <MobileTopBar />
        <Grid gutter="xl" align="start">
          {/* Left: Brand + Marketing */}
          <Grid.Col span={{ base: 12, md: 6, lg: 7 }} visibleFrom="md">
            {/* Tight hero spacing */}
            <Stack gap="xs" maw={620}>
              <LogoLockup className="auth-hero-lockup" size={90} titleOrder={2} />

              <Title
                order={1}
                className="auth-hero-title"
                style={{
                  marginTop: 0,
                  lineHeight: 1.05,
                  fontWeight: 800,
                  letterSpacing: -0.2,
                  fontSize: 'clamp(34px, 5vw, 56px)',
                }}
              >
                Secure, global messaging with{' '}
                <span className="text-blue-purple">instant translation</span>
              </Title>

              <Text size="lg" style={{ color: 'var(--fg)', opacity: 0.9, maxWidth: 560 }}>
                End-to-end encryption, AI-powered translation, disappearing
                messages, and voice/video calling.
              </Text>

              <List spacing="sm" size="sm" center className="auth-list">
                <List.Item
                  icon={
                    <ThemeIcon variant="filled" radius="xl"
                      style={{ background: 'var(--cta-gradient)', color: 'var(--cta-label)' }}>
                      <Lock size={16} />
                    </ThemeIcon>
                  }
                >
                  End-to-end encryption by default
                </List.Item>
                <List.Item
                  icon={
                    <ThemeIcon variant="filled" radius="xl"
                      style={{ background: 'var(--cta-gradient)', color: 'var(--cta-label)' }}>
                      <Globe size={16} />
                    </ThemeIcon>
                  }
                >
                  Auto-translate 100+ languages
                </List.Item>
                <List.Item
                  icon={
                    <ThemeIcon variant="filled" radius="xl"
                      style={{ background: 'var(--cta-gradient)', color: 'var(--cta-label)' }}>
                      <MessageCircle size={16} />
                    </ThemeIcon>
                  }
                >
                  Disappearing messages & read receipts
                </List.Item>
                <List.Item
                  icon={
                    <ThemeIcon variant="filled" radius="xl"
                      style={{ background: 'var(--cta-gradient)', color: 'var(--cta-label)' }}>
                      <ShieldCheck size={16} />
                    </ThemeIcon>
                  }
                >
                  Privacy-first. Your data, your control.
                </List.Item>
              </List>

              <Group gap="sm">
                <Button component={Link} to="/register" size="md" radius="xl">
                  Create free account
                </Button>
                <Anchor component={Link} to="/status" style={{ color: 'var(--accent)' }}>
                  Status
                </Anchor>
                <Anchor component={Link} to="/settings/upgrade" style={{ color: 'var(--accent)' }}>
                  Upgrade
                </Anchor>
              </Group>

              <Paper p="sm" withBorder radius="md">
                <Text size="xs" style={{ color: 'var(--fg)', opacity: 0.85 }}>
                  Tip: Use the same account on web and mobile. Your messages stay synced.
                </Text>
              </Paper>
            </Stack>
          </Grid.Col>

          {/* Right: Auth form + Get app */}
          <Grid.Col span={{ base: 12, md: 6, lg: 5 }} style={{ alignSelf: 'start' }}>
            <Stack gap="lg" style={{ maxWidth: 440, marginLeft: 'auto' }} className="auth-login">
              <Outlet />
              <GetAppCard />
            </Stack>
          </Grid.Col>
        </Grid>
      </Container>
    </div>
  );
}
