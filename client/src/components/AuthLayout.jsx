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
import { useTranslation } from 'react-i18next';
import Footer from '@/components/footer/Footer.jsx';

import '@/styles.css';

import HouseAdSlot from '@/ads/HouseAdSlot';

// Smart links
const APP_GENERIC = 'https://go.chatforia.com/app';
const APP_IOS = 'https://go.chatforia.com/ios';
const APP_ANDROID = 'https://go.chatforia.com/android';

function DebugBar() {
  return (
    <div style={{ padding: 12, background: '#111', border: '2px dashed magenta' }}>
      <div style={{ color: 'white', marginBottom: 8 }}>DEBUG: HouseAdSlot direct render</div>
      <HouseAdSlot placement="chat_footer" />
    </div>
  );
}

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
  const { t } = useTranslation();

  return (
    <Group hiddenFrom="md" gap="xs" align="center" wrap="nowrap" py="sm">
      <Anchor
        component={Link}
        to="/"
        aria-label={t('auth.goHome', 'Go home')}
        style={{ textDecoration: 'none' }}
      >
        <LogoLockup size={32} titleOrder={4} />
      </Anchor>
    </Group>
  );
}

/* ---------- “Get the app” card ---------- */
function GetAppCard() {
  const { t } = useTranslation();

  const BADGE_H = 'clamp(52px, 6vw, 72px)';
  const QR_SIZE = 'calc(1.1 * (clamp(52px, 6vw, 72px)))';
  const APPLE_SCALE = 0.76;

  return (
    <Paper withBorder shadow="xs" radius="xl" p="md">
      <Divider mb="md" label={t('auth.getApp', 'Get the app')} />
      <Group justify="space-between" wrap="nowrap" align="center">
        {/* QR: show on tablet/desktop */}
        <Group gap="sm" align="center" visibleFrom="sm">
          <Anchor
            href={APP_GENERIC}
            target="_blank"
            rel="noopener noreferrer"
            title={t('auth.openDownload', 'Open the download link')}
            style={{ display: 'inline-flex', padding: 6, borderRadius: 12 }}
          >
            <MantineImage
              src="/qr-chatforia.png"
              alt={t('auth.qrAlt', 'Scan to get Chatforia')}
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
            {t('auth.scanHelper', 'On desktop? Scan with your phone to get the app.')}
          </Text>
        </Group>

        {/* Badges */}
        <Stack gap="sm" align="stretch" style={{ minWidth: 260 }}>
          {/* App Store */}
          <Anchor
            href={APP_IOS}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('auth.iosAria', 'Download on the App Store')}
            title={t('auth.iosTitle', 'Download on the App Store')}
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
              alt={t('auth.iosBadgeAlt', 'Download on the App Store')}
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
            aria-label={t('auth.androidAria', 'Get it on Google Play')}
            title={t('auth.androidTitle', 'Get it on Google Play')}
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
              alt={t('auth.androidBadgeAlt', 'Get it on Google Play')}
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
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div id="top" className="auth-page min-h-screen flex flex-col">
      {/* Main public content */}
      <main className="flex-1">
        <Container size="lg" py="xl">
          <MobileTopBar />

          {/* breadcrumb/back link */}
          {location.pathname !== '/' && (
            <Anchor
              component={Link}
              to="/"
              aria-label={t('auth.goHome', 'Go home')}
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
              ← {t('auth.home', 'Home')}
            </Anchor>
          )}

          <Grid gutter="xl" align="start">
            {/* LEFT COLUMN */}
            <Grid.Col
              span={{ base: 12, md: 6, lg: 7 }}
              order={{ base: 1, md: 1 }}
            >
              <Stack gap="xs" maw={620}>
                <section className="hero">
                  {/* Lockup + H1 grid */}
                  <div className="hero-bubble-align" style={{ ['--bubble']: '90px' }}>
                    <span className="brand-logo" aria-hidden="true">
                      <LogoGlyph size="var(--bubble)" />
                    </span>

                    {/* Chatforia wordmark */}
                    <Title
                      order={2}
                      className="brand-lockup__name brand-lockup__name--solid"
                      style={{ margin: 0 }}
                    >
                      Chatforia
                    </Title>

                    {/* BIG HEADLINE */}
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
                      {t('auth.hero.line1', 'Secure, global')}
                      <br />
                      {t('auth.hero.beforeEm', 'messaging with')}{' '}
                      <span className="text-blue-purple">
                        {t('auth.hero.em', 'instant translation')}
                      </span>
                    </Title>
                  </div>

                  {/* Copy block under headline */}
                  <div className="hero-after">
                    <Text
                      size="lg"
                      style={{ color: 'var(--fg)', opacity: 0.9, maxWidth: 560 }}
                    >
                      {t(
                        'auth.hero.sub',
                        'Get a free secure phone number to call and text worldwide over Wi-Fi or data. Enjoy end-to-end encryption, AI-powered translation in 100+ languages, disappearing messages, and HD voice/video calling.'
                      )}
                    </Text>

                    {/* small clarifier */}
                    <Text
                      size="xs"
                      style={{
                        color: 'var(--fg)',
                        opacity: 0.7,
                        marginTop: 8,          // was 4 → a bit more space from subheadline
                        maxWidth: 560,
                      }}
                    >
                      {t(
                        'auth.hero.freeNote',
                        'Basic calling and texting are free. Advanced AI and premium features require an upgrade.'
                      )}
                    </Text>

                    {/* feature bullets */}
                    <List 
                      spacing="sm" 
                      size="sm" 
                      center 
                      className="auth-list"
                      style={{ marginTop: 8 }} 
                    >
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
                        {t('auth.feat.encryption', 'End-to-end encryption by default')}
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
                        {t('auth.feat.translate', 'Auto-translate 100+ languages')}
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
                        {t('auth.feat.disappear', 'Disappearing messages & read receipts')}
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
                        {t('auth.feat.privacy', 'Privacy-first. Your data, your control.')}
                      </List.Item>
                    </List>

                    {/* CTA row */}
                    <Group gap="sm">
                      <Button
                        component={Link}
                        to="/register"
                        size="md"
                        radius="xl"
                        aria-label={t('auth.createAccount', 'Create free account')}
                      >
                        {t('auth.createAccount', 'Create free account')}
                      </Button>

                      <Anchor
                        component={Link}
                        to="/upgrade"
                        style={{ color: 'var(--accent)' }}
                        aria-label={t('auth.upgrade', 'Upgrade')}
                      >
                        {t('auth.upgrade', 'Upgrade')}
                      </Anchor>
                    </Group>

                    {/* Tip box under row */}
                    <Paper p="sm" withBorder radius="md">
                      <Text
                        size="xs"
                        style={{ color: 'var(--fg)', opacity: 0.85 }}
                        aria-label={t(
                          'auth.tip',
                          'Tip: Use the same account on web and mobile. Your messages stay synced.'
                        )}
                      >
                        {t(
                          'auth.tip',
                          'Tip: Use the same account on web and mobile. Your messages stay synced.'
                        )}
                      </Text>
                    </Paper>
                  </div>
                </section>
              </Stack>
            </Grid.Col>

            {/* RIGHT COLUMN: login card + GetApp card */}
            <Grid.Col
              span={{ base: 12, md: 6, lg: 5 }}
              order={{ base: 2, md: 2 }}
              style={{ alignSelf: 'start' }}
            >
              <Stack gap="lg" className="auth-login">
                <Outlet />
                <GetAppCard />
              </Stack>
            </Grid.Col>
          </Grid>
                      
          {/* SupportWidget under grid */}
          <SupportWidget excludeRoutes={['/login', '/reset-password']} />
        </Container>
      </main>

      {/* footer at bottom */}
      <Footer />
    </div>
  );
}
