import { Outlet, Link, useLocation } from 'react-router-dom';
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
import SupportWidget from '@/components/support/SupportWidget.jsx';
import Footer from '@/components/footer/Footer.jsx';

import '@/styles.css';

// Smart links
const APP_GENERIC = 'https://go.chatforia.com/app';
const APP_IOS = 'https://go.chatforia.com/ios';
const APP_ANDROID = 'https://go.chatforia.com/android';

/* ---------- BRAND LOCKUP (used on mobile top bar) ---------- */
function LogoLockup({ size = 64, titleOrder = 4, className }) {
  return (
    <Group
      gap="xs"
      align="center"
      wrap="nowrap"
      className={`brand-lockup ${className || ''}`}
      style={{ '--logo-size': `${size}px` }}
    >
      <span className="brand-logo" aria-hidden="true">
        <LogoGlyph size={size} />
      </span>
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
      <Anchor component={Link} to="/" aria-label="Go home" style={{ textDecoration: 'none' }}>
        <LogoLockup size={32} titleOrder={4} />
      </Anchor>
    </Group>
  );
}

/* ---------- “Get the app” card ---------- */
function GetAppCard() {
  const BADGE_H = 'clamp(52px, 6vw, 72px)';
  const QR_SIZE = 'calc(1.1 * (clamp(52px, 6vw, 72px)))';
  const APPLE_SCALE = 0.78; // tweak between 0.83–0.87 if needed

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
                e.currentTarget.src = `https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(
                  APP_GENERIC
                )}`;
              }}
            />
          </Anchor>
          <Text size="sm" style={{ color: 'var(--fg)', opacity: 0.85 }} maw={240}>
            On desktop? Scan with your phone to get the app.
          </Text>
        </Group>

        {/* Badges */}
        <Stack gap="sm" align="stretch" style={{ minWidth: 260 }}>
          {/* App Store */}
          <Anchor
            href={APP_IOS}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download on the App Store"
            title="Download on the App Store"
            style={{
              display: 'inline-flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 6,
              borderRadius: 12,
              width: 220,
            }}
          >
            <MantineImage
              src="/badges/AppStore.svg"
              fit="contain"
              alt="Download on the App Store"
              h={BADGE_H}
              style={{
                width: 'auto',
                transform: `scale(${APPLE_SCALE})`,
                transformOrigin: 'center',
                display: 'block',
              }}
            />
          </Anchor>

          {/* Google Play */}
          <Anchor
            href={APP_ANDROID}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Get it on Google Play"
            title="Get it on Google Play"
            style={{
              display: 'inline-flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 6,
              borderRadius: 12,
              width: 220,
            }}
          >
            <MantineImage
              src="/badges/GooglePlay.svg"
              fit="contain"
              alt="Get it on Google Play"
              h={BADGE_H}
              style={{ width: 'auto', display: 'block' }}
            />
          </Anchor>
        </Stack>
      </Group>
    </Paper>
  );
}

/* ---------- Layout ---------- */
export default function AuthLayout() {
  const location = useLocation();

  return (
    <div id="top" className="auth-page min-h-screen flex flex-col">
      {/* Main public content */}
      <main className="flex-1">
        <Container size="lg" py="xl">
          <MobileTopBar />

          {/* Subtle breadcrumb / back-to-home on non-root routes */}
          {location.pathname !== '/' && (
            <Anchor
              component={Link}
              to="/"
              aria-label="Go home"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                opacity: 0.85,
                marginBottom: 12,
                textDecoration: 'none',
              }}
            >
              ← Home
            </Anchor>
          )}

          <Grid gutter="xl" align="start">
            {/* Left: Brand + Marketing */}
            <Grid.Col span={{ base: 12, md: 6, lg: 7 }} visibleFrom="md">
              <Stack gap="xs" maw={620}>
                <section className="hero">
                  {/* Lockup + H1 grid */}
                  <div className="hero-bubble-align" style={{ ['--bubble']: '90px' }}>
                    <span className="brand-logo" aria-hidden="true">
                      <LogoGlyph size="var(--bubble)" />
                    </span>

                    <Title
                      order={2}
                      className="brand-lockup__name brand-lockup__name--solid"
                      style={{ margin: 0 }}
                    >
                      Chatforia
                    </Title>

                    <Title
                      order={1}
                      className="auth-hero-title hero-bubble-title"
                      style={{
                        lineHeight: 1.05,
                        fontWeight: 800,
                        letterSpacing: -0.2,
                        fontSize: 'clamp(34px, 5vw, 56px)',
                      }}
                    >
                      Secure, global messaging with{' '}
                      <span className="text-blue-purple">instant translation</span>
                    </Title>
                  </div>

                  {/* Everything under the hero lockup (aligned to the “C”) */}
                  <div className="hero-after">
                    <Text size="lg" style={{ color: 'var(--fg)', opacity: 0.9, maxWidth: 560 }}>
                      End-to-end encryption, AI-powered translation, disappearing messages,
                      and voice/video calling.
                    </Text>

                    <List spacing="sm" size="sm" center className="auth-list">
                      <List.Item
                        icon={
                          <ThemeIcon
                            variant="filled"
                            radius="xl"
                            style={{
                              background: 'var(--cta-gradient)',
                              color: 'var(--cta-label)',
                            }}
                          >
                            <Lock size={16} />
                          </ThemeIcon>
                        }
                      >
                        End-to-end encryption by default
                      </List.Item>
                      <List.Item
                        icon={
                          <ThemeIcon
                            variant="filled"
                            radius="xl"
                            style={{
                              background: 'var(--cta-gradient)',
                              color: 'var(--cta-label)',
                            }}
                          >
                            <Globe size={16} />
                          </ThemeIcon>
                        }
                      >
                        Auto-translate 100+ languages
                      </List.Item>
                      <List.Item
                        icon={
                          <ThemeIcon
                            variant="filled"
                            radius="xl"
                            style={{
                              background: 'var(--cta-gradient)',
                              color: 'var(--cta-label)',
                            }}
                          >
                            <MessageCircle size={16} />
                          </ThemeIcon>
                        }
                      >
                        Disappearing messages & read receipts
                      </List.Item>
                      <List.Item
                        icon={
                          <ThemeIcon
                            variant="filled"
                            radius="xl"
                            style={{
                              background: 'var(--cta-gradient)',
                              color: 'var(--cta-label)',
                            }}
                          >
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
                      <Anchor
                        component={Link}
                        to="/settings/upgrade"
                        style={{ color: 'var(--accent)' }}
                      >
                        Upgrade
                      </Anchor>
                    </Group>

                    <Paper p="sm" withBorder radius="md">
                      <Text size="xs" style={{ color: 'var(--fg)', opacity: 0.85 }}>
                        Tip: Use the same account on web and mobile. Your messages stay synced.
                      </Text>
                    </Paper>
                  </div>
                </section>
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

          {/* Support widget visible on public pages (except specific routes) */}
          <SupportWidget excludeRoutes={['/login', '/reset-password']} />
        </Container>
      </main>

      {/* Footer: always visible on public pages */}
      <Footer />
    </div>
  );
}
