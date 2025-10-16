import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AppShell, Burger, Button, Group, Title, ScrollArea } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { useUser } from '@/context/UserContext';
import { RequirePremium } from '@/routes/guards';

// pages / components
import SettingsBackups from '@/pages/SettingsBackups.jsx';
import UpgradePage from '@/pages/UpgradePlan';
import Sidebar from '@/components/Sidebar';
import RandomChatPage from '@/pages/RandomChatPage.jsx';
import LoginForm from '@/components/LoginForm';
import Registration from '@/components/Registration';
import ForgotPassword from '@/components/ForgotPassword';
import ResetPassword from '@/components/ResetPassword';
import PeoplePage from '@/pages/PeoplePage';
import JoinInvitePage from '@/pages/JoinInvitePage.jsx';

// Admin
import AdminReportsPage from '@/pages/AdminReports';
import AdminRoute from '@/routes/AdminRoute';
import AdminLayout from '@/pages/AdminLayout';
import UsersAdminPage from '@/pages/UsersAdminPage';
import Forbidden from '@/pages/Forbidden';
import AuditLogsPage from '@/pages/AuditLogsPage';

// Feature flags
import { fetchFeatures } from '@/lib/features';
import StatusFeed from '@/pages/StatusFeed.jsx';

// Calls
import IncomingCallModal from '@/components/IncomingCallModal.jsx';
import VideoCall from '@/components/VideoCall.jsx';

// HTTP
import api, { primeCsrf } from '@/api/axiosClient';

// Public layout
import AuthLayout from '@/components/AuthLayout';

// Settings
import SettingsPage from '@/features/settings/SettingsPage';

// Index route content
import HomeIndex from '@/features/chat/HomeIndex';

// SMS
import SmsThreads from '@/pages/SmsThreads.jsx';
import SmsThreadView from '@/pages/SmsThreadView.jsx';

/* ---------- PUBLIC PAGES ---------- */
import AboutChatforia from '@/pages/AboutChatforia.jsx';
import Careers from '@/pages/Careers.jsx';
import Press from '@/pages/Press.jsx';
import HelpCenter from '@/pages/HelpCenter.jsx';
import ContactUs from '@/pages/ContactUs.jsx';
import Downloads from '@/pages/Downloads.jsx';
import Advertise from '@/pages/Advertise.jsx';
import SupportWidget from '@/components/support/SupportWidget.jsx';

// Legal
import PrivacyPolicy from '@/pages/legal/PrivacyPolicy.jsx';
import TermsOfService from '@/pages/legal/TermsOfService.jsx';
import DoNotSellMyInfo from '@/pages/legal/DoNotSellMyInfo.jsx';
import CookieSettings from '@/pages/legal/CookieSettings.jsx';

// OAuth completion
import OAuthComplete from '@/pages/OAuthComplete.jsx';

// Ads
import { AdProvider } from '@/ads/AdProvider';
import { CardAdWrap } from '@/ads/AdWrappers';
import HouseAdSlot from '@/ads/HouseAdSlot';

function AuthedLayout() {
  const [opened, { toggle }] = useDisclosure();
  const [selectedRoom, setSelectedRoom] = useState(null);
  const { currentUser, setCurrentUser } = useUser();
  const [features, setFeatures] = useState({ status: false });
  const [activeCall, setActiveCall] = useState(null);

  useEffect(() => {
    fetchFeatures().then(setFeatures).catch(() => setFeatures({ status: false }));
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

  const isPremium = Boolean(
    currentUser?.isPremium ||
    currentUser?.plan === 'premium' ||
    currentUser?.subscription?.tier === 'premium'
  );

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 300, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      aside={{ width: 280, breakpoint: 'lg', collapsed: { mobile: true } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              aria-label={opened ? 'Close navigation menu' : 'Open navigation menu'}
            />
            <Title order={3}>Chatforia</Title>
          </Group>
          <Button color="red" variant="filled" onClick={handleLogout} aria-label="Log out">
            Log Out
          </Button>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <ScrollArea.Autosize mah="calc(100vh - 120px)">
          <Sidebar currentUser={currentUser} setSelectedRoom={setSelectedRoom} features={features} />
        </ScrollArea.Autosize>
      </AppShell.Navbar>

      {/* Right rail (Free tier only) */}
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
          <VideoCall call={activeCall} currentUser={currentUser} onEnd={() => setActiveCall(null)} />
        )}

        {/* Provide ads context */}
        <AdProvider isPremium={isPremium}>
          <Outlet context={{ selectedRoom, setSelectedRoom, currentUser, features }} />
          <SupportWidget excludeRoutes={['/sms/threads', '/sms/call', '/admin']} />
        </AdProvider>
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
        {/* DEV helper route removed; redirect if someone visits it */}
        {import.meta.env.DEV && (
          <Route path="/dev/chat" element={<Navigate to="/" replace />} />
        )}

        {/* Public auth layout */}
        <Route element={<AuthLayout />}>
          <Route path="/" element={<LoginForm />} />
          <Route path="/register" element={<Registration />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* OAuth completes here */}
          <Route path="/auth/complete" element={<OAuthComplete />} />

          {/* Marketing/support/legal */}
          <Route path="/about" element={<AboutChatforia />} />
          <Route path="/careers" element={<Careers />} />
          <Route path="/press" element={<Press />} />
          <Route path="/advertise" element={<Advertise />} />
          <Route path="/help" element={<HelpCenter />} />
          <Route path="/contact" element={<ContactUs />} />
          <Route path="/download" element={<Downloads />} />

          {/* Legal */}
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
      <Route path="/forbidden" element={<Forbidden />} />
      <Route path="/auth/complete" element={<Navigate to="/" replace />} />

      {/* DEV helper route removed; redirect if someone visits it */}
      {import.meta.env.DEV && (
        <Route path="/dev/chat" element={<Navigate to="/" replace />} />
      )}

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
        <Route path="settings/upgrade" element={<UpgradePage />} />
        <Route path="/join/:code" element={<JoinInvitePage />} />
        <Route path="status" element={<StatusFeed />} />

        {/* SMS */}
        <Route path="sms" element={<SmsThreads />} />
        <Route path="sms/threads/:id" element={<SmsThreadView />} />

        {/* Admin */}
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
