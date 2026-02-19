import { useState, useEffect, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, Link } from 'react-router-dom';
import {
  AppShell,
  Burger,
  Button,
  Group,
  Title,
  ScrollArea,
  Anchor,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';

import { useUser } from '@/context/UserContext';
import { RequirePremium } from '@/routes/guards';

import SkipLink from '@/components/a11y/SkipLink.jsx';

// lazy: SettingsBackups is heavy — load it only when /settings/backups is visited
const SettingsBackups = React.lazy(() => import('@/pages/SettingsBackups.jsx'));

import UpgradePage from '@/pages/UpgradePlan';
import UpgradeSuccess from '@/pages/UpgradeSuccess.jsx';
import BillingReturn from '@/pages/BillingReturn.jsx';
import Sidebar from '@/components/Sidebar';
import RandomChatPage from '@/pages/RandomChatPage.jsx';
import LoginForm from '@/components/LoginForm';
import Registration from '@/components/Registration';
import ForgotPassword from '@/components/ForgotPassword';
import ResetPassword from '@/components/ResetPassword';
import PeoplePage from '@/pages/PeoplePage';
import JoinInvitePage from '@/pages/JoinInvitePage.jsx';
import ChatThreadRoute from './pages/ChatThreadRoute';

import FamilyJoin from '@/pages/FamilyJoin.jsx';

// ✅ NEW: Wireless dashboard
import WirelessDashboard from '@/pages/WirelessDashboard.jsx';
import ManageWirelessPage from '@/pages/ManageWireless.jsx';

import AdminReportsPage from '@/pages/AdminReports';
import AdminRoute from '@/routes/AdminRoute';
import AdminLayout from '@/pages/AdminLayout';
import UsersAdminPage from '@/pages/UsersAdminPage';
import Forbidden from '@/pages/Forbidden';
import AuditLogsPage from '@/pages/AuditLogsPage';

import { fetchFeatures } from '@/lib/features';

import IncomingCallModal from '@/components/IncomingCallModal.jsx';
import { CallProvider } from '@/context/CallContext';
import CallScreen from '@/components/call/CallScreen';

import { primeCsrf } from '@/api/axiosClient';

import AuthLayout from '@/components/AuthLayout';
import SettingsPage from '@/features/settings/SettingsPage';
import HomeIndex from '@/features/chat/HomeIndex';

import SmsThreads from '@/pages/SmsThreads.jsx';
import SmsCompose from '@/pages/SmsCompose.jsx';
import SmsLayout from '@/pages/SmsLayout.jsx';

import MyPlan from '@/pages/MyPlan.jsx';

import VoicemailPage from '@/pages/VoicemailPage.jsx';

import AboutChatforia from '@/pages/AboutChatforia.jsx';
import Careers from '@/pages/Careers.jsx';
import Press from '@/pages/Press.jsx';
import HelpCenter from '@/pages/HelpCenter.jsx';
import ContactUs from '@/pages/ContactUs.jsx';
import Downloads from '@/pages/Downloads.jsx';
import Advertise from '@/pages/Advertise.jsx';
import SupportWidget from '@/components/support/SupportWidget.jsx';

import PrivacyPolicy from '@/pages/legal/PrivacyPolicy.jsx';
import TermsOfService from '@/pages/legal/TermsOfService.jsx';
import DoNotSellMyInfo from '@/pages/legal/DoNotSellMyInfo.jsx';
import CookieSettings from '@/pages/legal/CookieSettings.jsx';

import OAuthComplete from '@/pages/OAuthComplete.jsx';
import GettingStarted from '@/pages/guides/GettingStarted.jsx';

import { AdProvider } from '@/ads/AdProvider';
import { CardAdWrap } from '@/ads/AdWrappers';
import HouseAdSlot from '@/ads/HouseAdSlot';

import NewStatusModal from '@/pages/NewStatusModal.jsx';
import LogoGlyph from '@/components/LogoGlyph.jsx';

import StatusFeed from '@/pages/StatusFeed.jsx';
import StatusBadge from '@/components/StatusBadge.jsx';

import i18n from '@/i18n';

// global modal host
import NewChatModalHost from '@/components/NewChatModalHost.jsx';

// Calls + Video hub
import Dialer from '@/components/routes/Dialer.jsx';
import Video from '@/components/routes/Video.jsx';

// ✅ eSIM activation page
import EsimActivatePage from '@/pages/EsimActivatePage.jsx';

const NAV_W = 300;
const ASIDE_W = 280;

function AuthedLayout() {
  const [opened, { toggle }] = useDisclosure();
  const [selectedRoom, setSelectedRoom] = useState(null);
  const { currentUser, logout } = useUser();
  const { t } = useTranslation();

  const [features, setFeatures] = useState({ status: true });
  const [showNewStatus, setShowNewStatus] = useState(false);
  const [hideStatusFab, setHideStatusFab] = useState(false);
  const location = useLocation();

  // Theme-safe CTA label style (fixes Log Out text on gradient themes)
  const ctaLabelStyles = {
    label: {
      color: 'var(--cta-on)',
      textShadow: 'var(--cta-on-shadow)',
    },
  };

  useEffect(() => {
    fetchFeatures()
      .then((f) => setFeatures({ ...f, status: f?.status ?? true }))
      .catch(() => setFeatures({ status: true }));
  }, []);

  // Sync i18n to user preference
  useEffect(() => {
    if (currentUser?.preferredLanguage) {
      i18n.changeLanguage(currentUser.preferredLanguage);
    }
  }, [currentUser?.preferredLanguage]);

  // Hide floating status pill when focusing inputs
  useEffect(() => {
    const onFocusIn = (e) => {
      const el = e.target;
      if (!el) return;
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el.getAttribute('role') === 'textbox') {
        setHideStatusFab(true);
      }
    };
    const onFocusOut = () => setHideStatusFab(false);
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
  };

  const plan = (currentUser?.plan || 'free').toLowerCase();
  const tier = (currentUser?.subscription?.tier || '').toLowerCase();
  const isPremium = Boolean(
    currentUser?.isPremium ||
      plan === 'premium' ||
      plan === 'plus' ||
      tier === 'premium' ||
      tier === 'plus'
  );

  const me = currentUser || {};

  const showStatusPill =
    Boolean(features?.status) &&
    location.pathname === '/' &&
    !hideStatusFab;

  return (
    <CallProvider me={me}>
      <AppShell
        header={{ height: 60 }}
        navbar={{ width: NAV_W, breakpoint: 'sm', collapsed: { mobile: !opened } }}
        aside={{ width: ASIDE_W, breakpoint: 'lg', collapsed: { mobile: true } }}
        padding="md"
        styles={{
          navbar: { flexShrink: 0 },
          aside: { flexShrink: 0 },
          main: { minWidth: 0 },
        }}
      >
        <AppShell.Header>
          <SkipLink targetId="main-content" />

          <Group
            h="100%"
            px="lg"
            justify="space-between"
            style={{ position: 'relative', overflow: 'visible' }}
          >
            {/* LEFT: burger + brand */}
            <Group>
              <Burger
                opened={opened}
                onClick={toggle}
                hiddenFrom="sm"
                aria-label={
                  opened
                    ? t('header.closeNav', 'Close navigation menu')
                    : t('header.openNav', 'Open navigation menu')
                }
              />
              <Anchor
                component={Link}
                to="/"
                underline="never"
                aria-label={t('header.homeAria', 'Chatforia Home')}
                style={{ color: 'inherit' }}
              >
                <Group gap={8}>
                  <LogoGlyph size={30} />
                  <Title order={3} m={0}>
                    {t('brand.name', 'Chatforia')}
                  </Title>
                </Group>
              </Anchor>
            </Group>

            {/* MIDDLE: New Status + StatusBadge */}
            {showStatusPill && (
              <div
                style={{
                  position: 'absolute',
                  left: NAV_W + 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 1,
                  pointerEvents: 'auto',
                }}
              >
                <Group gap="xs" align="center">
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => setShowNewStatus(true)}
                    aria-label={t('topbar.createStatusAria', 'Create new Status')}
                  >
                    {t('topbar.newStatus', 'New Status')}
                  </Button>
                  {features?.status && <StatusBadge />}
                </Group>
              </div>
            )}

            {/* RIGHT: Log Out */}
            <Group
              gap="sm"
              style={{
                paddingRight: 8,
                zIndex: 2,
                position: 'relative',
              }}
            >
              <Button
                color="red"
                variant="filled"
                onClick={handleLogout}
                aria-label={t('topbar.logout', 'Log Out')}
                styles={ctaLabelStyles}
              >
                {t('topbar.logout', 'Log Out')}
              </Button>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="md">
          <ScrollArea.Autosize mah="calc(100vh - 120px)">
            <Sidebar currentUser={currentUser} setSelectedRoom={setSelectedRoom} />
          </ScrollArea.Autosize>
        </AppShell.Navbar>

        <AppShell.Aside p="md">
          {!isPremium && (
            <div style={{ position: 'sticky', top: 12 }}>
              <CardAdWrap>
                <HouseAdSlot placement="right_rail" variant="card" />
              </CardAdWrap>
            </div>
          )}
        </AppShell.Aside>

        <AppShell.Main id="main-content" tabIndex={-1}>
          {/* Global call UI */}
          <IncomingCallModal />
          <CallScreen />

          <AdProvider isPremium={isPremium}>
            <Outlet context={{ selectedRoom, setSelectedRoom, currentUser, features }} />
            <SupportWidget excludeRoutes={['/sms', '/admin']} />
          </AdProvider>

          {features?.status && (
            <NewStatusModal opened={showNewStatus} onClose={() => setShowNewStatus(false)} />
          )}

          {/* Mount once for StartChat modal */}
          <NewChatModalHost currentUserId={currentUser?.id} />
        </AppShell.Main>
      </AppShell>
    </CallProvider>
  );
}

export default function AppRoutes() {
  const { currentUser } = useUser();

  useEffect(() => {
    primeCsrf().catch(() => {});
  }, []);

  if (!currentUser) {
    return (
      <Routes>
        {/* Public pricing / upgrade page (no AuthLayout hero) */}
        <Route path="/upgrade" element={<UpgradePage variant="account" />} />
        <Route path="/pricing" element={<UpgradePage variant="public" />} />

        {/* Auth + marketing layout */}
        <Route element={<AuthLayout />}>
          <Route path="/" element={<LoginForm />} />
          <Route path="/register" element={<Registration />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/complete" element={<OAuthComplete />} />

          <Route path="/about" element={<AboutChatforia />} />
          <Route path="/careers" element={<Careers />} />
          <Route path="/press" element={<Press />} />
          <Route path="/advertise" element={<Advertise />} />
          <Route path="/help" element={<HelpCenter />} />
          <Route path="/contact" element={<ContactUs />} />
          <Route path="/download" element={<Downloads />} />

          <Route path="/guides/getting-started" element={<GettingStarted />} />
          <Route path="/guides" element={<Navigate to="/guides/getting-started" replace />} />
          <Route path="/tips" element={<Navigate to="/guides/getting-started" replace />} />
          <Route path="/blog" element={<Navigate to="/guides/getting-started" replace />} />

          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/legal/terms" element={<TermsOfService />} />
          <Route path="/legal/do-not-sell" element={<DoNotSellMyInfo />} />
          <Route path="/legal/cookies" element={<CookieSettings />} />

          {/* Family invite join route (works even when logged out) */}
          <Route path="/family/join/:token" element={<FamilyJoin />} />
        </Route>

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/upgrade" element={<UpgradePage variant="account" />} />
      <Route path="/pricing" element={<Navigate to="/upgrade" replace />} />
      <Route path="/upgrade/success" element={<UpgradeSuccess />} />
      <Route path="/billing/return" element={<BillingReturn />} />
      <Route path="/settings/upgrade" element={<Navigate to="/upgrade" replace />} />
      <Route path="/forbidden" element={<Forbidden />} />
      <Route path="/auth/complete" element={<Navigate to="/" replace />} />
      {import.meta.env.DEV && <Route path="/dev/chat" element={<Navigate to="/" replace />} />}

      <Route path="/" element={<AuthedLayout />}>
        <Route index element={<HomeIndex />} />
        <Route path="status" element={<StatusFeed />} />
        <Route path="random" element={<RandomChatPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="settings" element={<SettingsPage />} />

        <Route
          path="settings/backups"
          element={
            <RequirePremium>
              <Suspense fallback={<div>Loading settings…</div>}>
                <SettingsBackups />
              </Suspense>
            </RequirePremium>
          }
        />

        {/* Calls + Video hub */}
        <Route path="dialer" element={<Dialer />} />
        <Route path="video" element={<Video />} />
        <Route path="voicemail" element={<VoicemailPage />} />

        <Route path="chat/:id" element={<ChatThreadRoute />} />

        {/* ✅ Wireless */}
        <Route path="wireless" element={<WirelessDashboard />} />
        <Route path="wireless/manage" element={<ManageWirelessPage />} />

        {/* ✅ Keep /family working, but point it to /wireless */}
        <Route path="family" element={<Navigate to="/wireless" replace />} />
        <Route path="family/join/:token" element={<FamilyJoin />} />

        <Route path="guides/getting-started" element={<GettingStarted />} />
        <Route path="guides" element={<Navigate to="guides/getting-started" replace />} />
        <Route path="tips" element={<Navigate to="guides/getting-started" replace />} />
        <Route path="blog" element={<Navigate to="guides/getting-started" replace />} />
        <Route path="join/:code" element={<JoinInvitePage />} />

        {/* ✅ SMS ROUTES
            IMPORTANT: SmsLayout is the thread view, not a router layout.
            So we mount it at /sms/:threadId directly.
        */}
        <Route path="sms">
          <Route index element={<SmsThreads />} />
          <Route path="compose" element={<SmsCompose />} />

          {/* legacy redirect: /sms/threads/:id -> /sms/:id */}
          <Route path="threads/:id" element={<Navigate to="../:id" replace />} />

          {/* thread view */}
          <Route
            path=":threadId"
            element={<SmsLayout currentUserId={currentUser?.id} currentUser={currentUser} />}
          />
        </Route>

        <Route path="account/plan" element={<MyPlan />} />

        {/* ✅ eSIM activation */}
        <Route path="account/esim" element={<EsimActivatePage />} />

        <Route
          path="admin"
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route path="users" element={<UsersAdminPage />} />
          <Route path="reports" element={<AdminReportsPage />} />
          <Route path="audit" element={<AuditLogsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
