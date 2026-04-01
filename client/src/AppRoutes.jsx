import { useState, useEffect, Suspense, lazy } from 'react';
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
const SettingsBackups = lazy(() => import('@/pages/SettingsBackups.jsx'));

import UpgradePage from '@/pages/UpgradePlan';
import UpgradeSuccess from '@/pages/UpgradeSuccess.jsx';
import BillingReturn from '@/pages/BillingReturn.jsx';
import Sidebar from '@/components/Sidebar';
import RandomChatPage from '@/pages/RandomChatPage.jsx';
import LoginForm from '@/components/LoginForm';
import Registration from '@/components/Registration';
import VerifyPhoneConsentPage from '@/pages/VerifyPhoneConsentPage.jsx';
import VerifyCodePage from '@/pages/VerifyCodePage.jsx';
import ForgotPassword from '@/components/ForgotPassword';
import ResetPassword from '@/components/ResetPassword';
import PeoplePage from '@/pages/PeoplePage';
import JoinInvitePage from '@/pages/JoinInvitePage.jsx';
import ChatThreadRoute from './pages/ChatThreadRoute';
import PairBrowserPage from '@/pages/PairBrowserPage.jsx';

import FamilyJoin from '@/pages/FamilyJoin.jsx';

import EncryptionRecoveryCard from '@/components/security/EncryptionRecoveryCard.jsx';

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
import SmsPolicy from '@/pages/legal/SmsPolicy.jsx';
import SmsConsentPage from './pages/SmsConsentPage';
import DoNotSellMyInfo from '@/pages/legal/DoNotSellMyInfo.jsx';
import CookieSettings from '@/pages/legal/CookieSettings.jsx';

import OAuthComplete from '@/pages/OAuthComplete.jsx';
import GettingStarted from '@/pages/guides/GettingStarted.jsx';

import { AdProvider } from '@/ads/AdProvider';
import { CardAdWrap } from '@/ads/AdWrappers';
import HouseAdSlot from '@/ads/HouseAdSlot';

import LogoGlyph from '@/components/LogoGlyph.jsx';

import i18n from '@/i18n';


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


  return (
    <CallProvider me={me}>
      <AppShell
          header={{ height: 60 }}
          navbar={{ width: NAV_W, breakpoint: 'sm', collapsed: { mobile: !opened } }}
          aside={{ width: ASIDE_W, breakpoint: 'lg', collapsed: { mobile: true } }}
          padding="md"
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
          }}
          styles={{
            navbar: { flexShrink: 0 },
            aside: { flexShrink: 0 },
            main: {
              minWidth: 0,
              minHeight: 0,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
            },
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
         <AppShell.Main
            id="main-content"
            tabIndex={-1}
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto', // 🔥 THIS FIXES YOUR PROBLEM
            }}
          >
            {/* Global call UI */}
            <IncomingCallModal />
            <CallScreen />

            <AdProvider isPremium={isPremium}>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Outlet context={{ selectedRoom, setSelectedRoom, currentUser, features }} />
              </div>

              <SupportWidget excludeRoutes={['/sms', '/admin']} />
            </AdProvider>
          </AppShell.Main>
      </AppShell>
    </CallProvider>
  );
}

export default function AppRoutes() {
 const { currentUser, authLoading, needsKeyUnlock, pairingPending } = useUser();

  useEffect(() => {
    primeCsrf().catch(() => {});
  }, []);

  if (authLoading) {
    return null;
  }

  if (currentUser && pairingPending) {
    return <Navigate to="/pair-browser" replace />;
  }

  if (currentUser && needsKeyUnlock) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
        }}
      >
        <div style={{ width: '100%', maxWidth: 640 }}>
          <EncryptionRecoveryCard
            blocked
            title="Restore or unlock your encryption key"
            description="This browser is missing or using the wrong encryption key for your Chatforia account."
          />
        </div>
      </div>
    );
  }

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
          <Route path="/verify-phone-consent" element={<VerifyPhoneConsentPage />} />
          <Route path="/verify-code" element={<VerifyCodePage />} />
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
          <Route path="/legal/sms" element={<SmsPolicy />} />
          <Route path="/legal/do-not-sell" element={<DoNotSellMyInfo />} />
          <Route path="/legal/cookies" element={<CookieSettings />} />
          <Route path="/legal/consent" element={<SmsConsentPage />} />
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

      {/* Ensure /sms-consent exists for authenticated users as well */}
      <Route path="/legal/consent" element={<SmsConsentPage />} />

      <Route path="/" element={<AuthedLayout />}>
        <Route path="/pair-browser" element={<PairBrowserPage />} />
        <Route index element={<HomeIndex />} />
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