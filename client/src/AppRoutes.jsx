import { useState, useEffect } from 'react';
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

import { useUser } from '@/context/UserContext';
import { RequirePremium } from '@/routes/guards';

import SettingsBackups from '@/pages/SettingsBackups.jsx';
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

import AdminReportsPage from '@/pages/AdminReports';
import AdminRoute from '@/routes/AdminRoute';
import AdminLayout from '@/pages/AdminLayout';
import UsersAdminPage from '@/pages/UsersAdminPage';
import Forbidden from '@/pages/Forbidden';
import AuditLogsPage from '@/pages/AuditLogsPage';

import { fetchFeatures } from '@/lib/features';

import IncomingCallModal from '@/components/IncomingCallModal.jsx';
import VideoCall from '@/video/VideoCall.jsx';

import api, { primeCsrf } from '@/api/axiosClient';

import AuthLayout from '@/components/AuthLayout';
import SettingsPage from '@/features/settings/SettingsPage';
import HomeIndex from '@/features/chat/HomeIndex';

import SmsThreads from '@/pages/SmsThreads.jsx';
import SmsThreadView from '@/pages/SmsThreadView.jsx';
import SmsThreadPage from '@/pages/SmsThreadPage.jsx';
import SmsCompose from '@/pages/SmsCompose.jsx';

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

// ✅ Import your LogoGlyph component
import LogoGlyph from '@/components/LogoGlyph.jsx';

const NAV_W = 300;   // keep in sync with AppShell.navbar width
const ASIDE_W = 280; // keep in sync with AppShell.aside width

function AuthedLayout() {
  const [opened, { toggle }] = useDisclosure();
  const [selectedRoom, setSelectedRoom] = useState(null);
  const { currentUser, setCurrentUser } = useUser();

  const [features, setFeatures] = useState({ status: true });
  const [activeCall, setActiveCall] = useState(null);
  const [showNewStatus, setShowNewStatus] = useState(false);
  const [hideStatusFab, setHideStatusFab] = useState(false);
  const location = useLocation();

  useEffect(() => {
    fetchFeatures()
      .then((f) => setFeatures({ ...f, status: f?.status ?? true }))
      .catch(() => setFeatures({ status: true }));
  }, []);

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
    try { await api.post('/auth/logout'); } catch {}
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    setCurrentUser(null);
    window.location.assign('/login');
  };

  const handleAcceptIncoming = (payload) => {
    setActiveCall({
      callId: payload.callId,
      partnerId: payload.fromUserId,
      chatId: payload.chatId ?? null,
      mode: payload.mode || 'VIDEO',
      inbound: true,
      offerSdp: payload.sdp,
    });
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
  const peerId = null;

  const showStatusPill =
    Boolean(features?.status) &&
    location.pathname === '/' &&
    !hideStatusFab;

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: NAV_W, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      aside={{ width: ASIDE_W, breakpoint: 'lg', collapsed: { mobile: true } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" style={{ position: 'relative' }}>
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              aria-label={opened ? 'Close navigation menu' : 'Open navigation menu'}
            />

            {/* ✅ Logo + title (linked to home) */}
            <Anchor
              component={Link}
              to="/"
              underline="never"
              aria-label="Chatforia Home"
              style={{ color: 'inherit' }}
            >
              <Group gap={8}>
                <LogoGlyph size={30} />
                <Title order={3} m={0}>Chatforia</Title>
              </Group>
            </Anchor>
          </Group>

          {/* ✅ Status pill lives in the header, not in Main */}
          {showStatusPill && (
            <div
              style={{
                position: 'absolute',
                left: NAV_W + 16,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            >
              <Button
                size="xs"
                variant="light"
                onClick={() => setShowNewStatus(true)}
                aria-label="Create new Status"
              >
                New Status
              </Button>
            </div>
          )}

          <Button color="red" variant="filled" onClick={handleLogout} aria-label="Log out">
            Log Out
          </Button>
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
        <IncomingCallModal onAccept={handleAcceptIncoming} onReject={() => setActiveCall(null)} />
        {activeCall && (
          <VideoCall
            identity={me.username}
            room={`dm:${peerId}`}
            onEnd={() => setActiveCall(null)}
          />
        )}

        <AdProvider isPremium={isPremium}>
          <Outlet context={{ selectedRoom, setSelectedRoom, currentUser, features }} />
          <SupportWidget excludeRoutes={['/sms/threads', '/sms/call', '/admin']} />
        </AdProvider>

        {features?.status && (
          <NewStatusModal opened={showNewStatus} onClose={() => setShowNewStatus(false)} />
        )}
      </AppShell.Main>
    </AppShell>
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
        <Route path="/upgrade" element={<UpgradePage variant="public" />} />
        <Route path="/upgrade/success" element={<UpgradeSuccess />} />
        <Route path="/billing/return" element={<BillingReturn />} />
        <Route path="/settings/upgrade" element={<Navigate to="/upgrade" replace />} />

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

          <Route path="/legal/privacy" element={<PrivacyPolicy />} />
          <Route path="/legal/terms" element={<TermsOfService />} />
          <Route path="/legal/do-not-sell" element={<DoNotSellMyInfo />} />
          <Route path="/legal/cookies" element={<CookieSettings />} />
        </Route>

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/upgrade" element={<UpgradePage variant="account" />} />
      <Route path="/upgrade/success" element={<UpgradeSuccess />} />
      <Route path="/billing/return" element={<BillingReturn />} />
      <Route path="/settings/upgrade" element={<Navigate to="/upgrade" replace />} />

      <Route path="/forbidden" element={<Forbidden />} />
      <Route path="/auth/complete" element={<Navigate to="/" replace />} />
      {import.meta.env.DEV && <Route path="/dev/chat" element={<Navigate to="/" replace />} />}

      <Route path="/" element={<AuthedLayout />}>
        <Route index element={<HomeIndex />} />
        <Route path="random" element={<RandomChatPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="settings" element={<SettingsPage />} />

        <Route
          path="settings/backups"
          element={
            <RequirePremium>
              <SettingsBackups />
            </RequirePremium>
          }
        />

        <Route path="guides/getting-started" element={<GettingStarted />} />
        <Route path="guides" element={<Navigate to="guides/getting-started" replace />} />
        <Route path="tips" element={<Navigate to="guides/getting-started" replace />} />
        <Route path="blog" element={<Navigate to="guides/getting-started" replace />} />

        <Route path="join/:code" element={<JoinInvitePage />} />

        <Route path="sms" element={<SmsThreads />} />
        <Route path="sms/threads/:id" element={<SmsThreadView />} />
        <Route path="sms/:threadId" element={<SmsThreadPage />} />
        <Route path="sms/compose" element={<SmsCompose />} />

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
