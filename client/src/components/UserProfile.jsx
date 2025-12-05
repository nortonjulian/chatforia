import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  Paper,
  Title,
  Stack,
  Group,
  Text,
  Button,
  Switch,
  FileInput,
  NumberInput,
  Avatar,
  Card,
  Loader,
  Badge,
  Alert,
  Accordion,
  useMantineColorScheme,
  Divider,
  Select,
  MultiSelect,
  TextInput,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconUpload, IconCloudUpload, IconSun, IconMoon } from '@tabler/icons-react';

import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';
import LanguageSelector from './LanguageSelector';
import PremiumGuard from './PremiumGuard';
import SoundSettings from './SoundSettings';
import LinkedDevicesPanel from './LinkedDevicesPanel';
import PrivacySection from '../pages/PrivacySection';

import ThemeSelect from '../components/settings/ThemeSelect.jsx';
import { getTheme, setTheme, onThemeChange, isLightTheme } from '../utils/themeManager.js';
import { setFaviconForTheme } from '../utils/favicon.js';
import { premiumPreviewEnabled } from '../utils/premiumPreview.js';

import { loadKeysLocal, saveKeysLocal, generateKeypair } from '../utils/keys';
import { exportEncryptedPrivateKey, importEncryptedPrivateKey } from '../utils/keyBackup';

/* Phone number */
import PhoneNumberManager from '@/components/profile/PhoneNumberManager';

import PhoneWarningBanner from '@/components/PhoneWarningBanner.jsx';

/* 2FA */
import TwoFASection from '@/components/security/TwoFASection.jsx';
/* ✅ Forwarding lives outside the accordion */
import ForwardingSettings from '@/features/settings/ForwardingSettings.jsx';

/* ---------- helpers ---------- */
function lazyWithFallback(importer, Fallback = () => null) {
  return React.lazy(() =>
    importer()
      .then((m) => m)
      .catch(() => ({ default: Fallback }))
  );
}

const LazyAISettings = lazyWithFallback(() =>
  import('../pages/AISettings').catch(() => ({ default: () => null }))
);
const LazySettingsAccessibility = lazyWithFallback(() =>
  import('../pages/SettingsAccessibility').catch(() => ({ default: () => null }))
);

class SectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error('[UserProfile] section crashed:', err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <Alert color="red" variant="light" title={this.props.fallbackText}>
          {this.props.fallbackText}
        </Alert>
      );
    }
    return this.props.children;
  }
}

function AdvancedTtlControls({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <Group align="flex-end" gap="sm">
      <NumberInput
        label={t('profile.disappearAfterSeconds', 'Disappear after (seconds)')}
        min={1}
        max={7 * 24 * 3600}
        step={60}
        value={value}
        onChange={(v) => onChange(Number(v) || 0)}
        clampBehavior="strict"
      />
      <NumberInput
        label={t('profile.presetSeconds', 'Preset (seconds)')}
        placeholder={t('profile.typeOrPick', 'Type or pick')}
        value={value}
        onChange={(v) => onChange(Number(v) || 0)}
      />
    </Group>
  );
}

/* Utility: find the nearest scrollable parent (Drawer content, etc.) */
function getScrollParent(el) {
  let p = el?.parentElement;
  while (p) {
    const style = window.getComputedStyle(p);
    const oy = style.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

/* ---------- main ---------- */
export default function UserProfile({ onLanguageChange, openSection }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentUser, setCurrentUser } = useUser();

  const API_BASE =
    import.meta.env.VITE_API_ORIGIN ||
    import.meta.env.VITE_API_BASE_URL ||
    ''; // '' works in dev if Vite proxies /uploads to the API

  const getAvatarSrc = (userLike) => {
    if (!userLike?.avatarUrl) return '/default-avatar.png';

    // If backend already stored a full URL, just use it
    if (userLike.avatarUrl.startsWith('http')) {
      return userLike.avatarUrl;
    }

    // Otherwise treat it as a path on the API host
    return `${API_BASE}${userLike.avatarUrl}`;
  };

  const params = useParams();
  const viewUserId = params.userId ? Number(params.userId) : null;
  const viewingAnother = !!(viewUserId && currentUser && viewUserId !== currentUser.id);

  const importFileRef = useRef(null);
  const forwardingAnchorRef = useRef(null);

  const { setColorScheme } = useMantineColorScheme();
  const [themeNow, setThemeNow] = useState(getTheme());
  const [coolCtasOnMidnight, setCoolCtasOnMidnight] = useState(
    typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-cta') === 'cool'
  );

  /* View-another-user state */
  const [loadingView, setLoadingView] = useState(viewingAnother);
  const [viewUser, setViewUser] = useState(null);
  const [followStats, setFollowStats] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);

  /* Plan section state */
  const [planInfo, setPlanInfo] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');
  const [portalBusy, setPortalBusy] = useState(false);

  // ✅ Defaults that are safe even if currentUser is temporarily null
  const [preferredLanguage, setPreferredLanguage] = useState(
    currentUser?.preferredLanguage || i18n.language || 'en'
  );
  const [autoTranslate, setAutoTranslate] = useState(
    typeof currentUser?.autoTranslate === 'boolean' ? currentUser.autoTranslate : false
  );
  const [showOriginalWithTranslation, setShowOriginalWithTranslation] = useState(
    typeof currentUser?.showOriginalWithTranslation === 'boolean'
      ? currentUser.showOriginalWithTranslation
      : false
  );
  const [allowExplicitContent, setAllowExplicitContent] = useState(
    currentUser?.allowExplicitContent ?? false
  );
  const [showReadReceipts, setShowReadReceipts] = useState(
    typeof currentUser?.showReadReceipts === 'boolean'
      ? currentUser.showReadReceipts
      : false
  );
  const [autoDeleteSeconds, setAutoDeleteSeconds] = useState(
    currentUser?.autoDeleteSeconds || 0
  );
  const [privacyBlurEnabled, setPrivacyBlurEnabled] = useState(
    currentUser?.privacyBlurEnabled ?? false
  );
  const [privacyBlurOnUnfocus, setPrivacyBlurOnUnfocus] = useState(
    currentUser?.privacyBlurOnUnfocus ?? false
  );
  const [privacyHoldToReveal, setPrivacyHoldToReveal] = useState(
    currentUser?.privacyHoldToReveal ?? false
  );
  const [notifyOnCopy, setNotifyOnCopy] = useState(currentUser?.notifyOnCopy ?? false);

  // 🔢 Age + Random Chat
  const [ageBand, setAgeBand] = useState(currentUser?.ageBand || null);
  const [wantsAgeFilter, setWantsAgeFilter] = useState(
    typeof currentUser?.wantsAgeFilter === 'boolean'
      ? currentUser.wantsAgeFilter
      : true
  );
  const [randomChatAllowedBands, setRandomChatAllowedBands] = useState(
    currentUser?.randomChatAllowedBands || []
  );

  // 🧠 Foria memory toggle
  const [foriaRemember, setForiaRemember] = useState(
    typeof currentUser?.foriaRemember === 'boolean'
      ? currentUser.foriaRemember
      : true
  );

  // 🔔 Voicemail settings
  const [voicemailEnabled, setVoicemailEnabled] = useState(
    typeof currentUser?.voicemailEnabled === 'boolean'
      ? currentUser.voicemailEnabled
      : true
  );
  const [voicemailAutoDeleteDays, setVoicemailAutoDeleteDays] = useState(
    currentUser?.voicemailAutoDeleteDays ?? null
  );
  const [voicemailForwardEmail, setVoicemailForwardEmail] = useState(
    currentUser?.voicemailForwardEmail || currentUser?.email || ''
  );
  const [voicemailGreetingText, setVoicemailGreetingText] = useState(
    currentUser?.voicemailGreetingText || ''
  );
  const [voicemailGreetingUploading, setVoicemailGreetingUploading] = useState(false);

  // Avatar upload state (inline error instead of toast)
  const [avatarError, setAvatarError] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Accordion open state
  const [openItems, setOpenItems] = useState([]);

  /* ---------- effects ---------- */

  useEffect(() => onThemeChange(setThemeNow), [onThemeChange]);
  useEffect(() => {
    const theme = getTheme();
    setColorScheme(isLightTheme(theme) ? 'light' : 'dark');
    setFaviconForTheme(theme);
  }, [setColorScheme]);

  // View another user
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      if (!viewingAnother) return;
      setLoadingView(true);
      try {
        const [{ data: u }, { data: stats }] = await Promise.all([
          axiosClient.get(`/users/${viewUserId}`),
          axiosClient.get(`/follows/${viewUserId}/stats`),
        ]);
        if (!cancelled) {
          setViewUser(u);
          setFollowStats(stats);
        }
      } catch (e) {
        console.error('load profile failed', e);
        notifications.show({
          color: 'red',
          message: t('profile.loadFailed', 'Failed to load profile'),
        });
      } finally {
        if (!cancelled) setLoadingView(false);
      }
    };
    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [viewingAnother, viewUserId, t]);

  // Load plan info
  useEffect(() => {
    let cancelled = false;

    async function loadPlan() {
      try {
        setPlanLoading(true);
        const { data } = await axiosClient.get('/billing/my-plan');
        if (!cancelled && data?.plan) {
          setPlanInfo(data.plan);
        }
      } catch (e) {
        console.error('Failed to load plan', e);
        if (!cancelled) {
          setPlanError(
            t('profile.planLoadFailed', 'Failed to load your plan.')
          );
        }
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    }

    loadPlan();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Keep UI theme in sync if user state changes (e.g., login in another tab)
  useEffect(() => {
    if (currentUser?.theme) {
      applyTheme(currentUser.theme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.theme]);

  // Scroll to forwarding section (outside accordion) if requested
  useEffect(() => {
    if (openSection === 'forwarding' && forwardingAnchorRef.current) {
      const el = forwardingAnchorRef.current;
      const scrollToAnchor = () => {
        const parent = getScrollParent(el);
        const rect = el.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect
          ? parent.getBoundingClientRect()
          : { top: 0 };
        const top = (parent.scrollTop || 0) + (rect.top - parentRect.top) - 12;
        parent.scrollTo({ top, behavior: 'smooth' });
      };
      requestAnimationFrame(() => {
        scrollToAnchor();
        setTimeout(scrollToAnchor, 80);
      });
    }
  }, [openSection]);

  /* ---------- derived values & helpers ---------- */

  const applyTheme = (themeName) => {
    setTheme(themeName);
    setColorScheme(isLightTheme(themeName) ? 'light' : 'dark');
    setFaviconForTheme(themeName);
    if (themeName !== 'midnight') {
      document.documentElement.removeAttribute('data-cta');
      setCoolCtasOnMidnight(false);
    }
  };

  const planUpper = ((currentUser?.plan) || 'FREE').toUpperCase();
  const isPremiumPlan = planUpper === 'PREMIUM';
  const canSeePremiumThemes = isPremiumPlan || premiumPreviewEnabled();
  const hasEsim = Boolean(currentUser?.esimIccid); 

  const refreshAuthUser = async () => {
    try {
      const { data } = await axiosClient.get('/auth/me');
      if (data?.user) setCurrentUser((prev) => ({ ...prev, ...data.user }));
    } catch (e) {
      console.error('Failed to refresh /auth/me', e);
    }
  };

  const openBillingPortal = async () => {
    try {
      setPortalBusy(true);

      // ✅ This MUST be a POST, and MUST go through axiosClient
      const { data } = await axiosClient.post('/billing/portal');

      const url = data?.url || data?.portalUrl;
      if (!url) throw new Error('No portal URL returned');

      // ✅ Now do a full page redirect *only* to Stripe URL
      window.location.href = url;
    } catch (e) {
      console.error('Failed to open billing portal', e);
      notifications.show({
        color: 'red',
        message: t(
          'profile.portalOpenFailed',
          'Could not open billing portal. Please try again.'
        ),
      });
    } finally {
      setPortalBusy(false);
    }
  };

  const saveSettings = async () => {
    try {
      const chosenTheme = getTheme();
      const payload = {
        preferredLanguage,
        autoTranslate,
        showOriginalWithTranslation,
        theme: chosenTheme,
        allowExplicitContent,
        showReadReceipts,
        autoDeleteSeconds: parseInt(autoDeleteSeconds || 0, 10),
        privacyBlurEnabled,
        privacyBlurOnUnfocus,
        privacyHoldToReveal,
        notifyOnCopy,
        // Age + Random Chat
        ageBand,
        wantsAgeFilter,
        randomChatAllowedBands,
        // Foria memory
        foriaRemember,
        // Voicemail
        voicemailEnabled,
        voicemailAutoDeleteDays:
          voicemailAutoDeleteDays === '' || voicemailAutoDeleteDays == null
            ? null
            : Number(voicemailAutoDeleteDays),
        voicemailForwardEmail,
        voicemailGreetingText,
      };
      await axiosClient.patch(`/users/me`, payload);

      i18n.changeLanguage(preferredLanguage);
      onLanguageChange?.(preferredLanguage);
      setCurrentUser((prev) => ({ ...prev, ...payload }));

      notifications.show({
        color: 'green',
        message: t('profile.saveSuccess', 'Settings saved'),
      });
    } catch (error) {
      console.error('Failed to save settings', error);
      notifications.show({
        color: 'red',
        message: t('profile.saveError', 'Failed to save settings'),
      });
    }
  };
  
    const handleAvatarUpload = async (file) => {
    if (!file) return;

    setAvatarError('');
    setAvatarUploading(true);

    const formData = new FormData();
    // 👇 MUST match uploadAvatar.single('avatar') in users.js
    formData.append('avatar', file);

    try {
      const { data } = await axiosClient.post('/users/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (!data?.avatarUrl) {
        throw new Error('No avatarUrl returned from server');
      }

      // Update currentUser in context so Avatar re-renders immediately
      setCurrentUser((prev) => ({
        ...prev,
        avatarUrl: data.avatarUrl,
      }));

      notifications.show({
        color: 'green',
        message: t('profile.avatarUpdated', 'Avatar updated!'),
      });
    } catch (err) {
      console.error('Avatar upload failed', err);
      setAvatarError(t('profile.avatarError', 'Failed to upload avatar'));
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleVoicemailGreetingUpload = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    try {
      setVoicemailGreetingUploading(true);
      const { data } = await axiosClient.post('/api/voicemail/greeting', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (data.greetingUrl) {
        setCurrentUser((prev) => ({ ...prev, voicemailGreetingUrl: data.greetingUrl }));
        notifications.show({
          color: 'green',
          message: t(
            'profile.voicemailGreetingUploaded',
            'Voicemail greeting uploaded successfully'
          ),
        });
      } else {
        throw new Error('No greetingUrl returned');
      }
    } catch (err) {
      console.error('Voicemail greeting upload failed', err);
      notifications.show({
        color: 'red',
        message: t(
          'profile.voicemailGreetingUploadError',
          'Failed to upload voicemail greeting'
        ),
      });
    } finally {
      setVoicemailGreetingUploading(false);
    }
  };

  const exportKey = async () => {
    try {
      const { privateKey } = await loadKeysLocal();
      if (!privateKey) {
        notifications.show({
          color: 'red',
          message: t('profile.noPrivateKey', 'No private key found'),
        });
        return;
      }
      const pwd = window.prompt(
        t('profile.setBackupPassword', 'Set a password to encrypt your backup')
      );
      if (!pwd) return;
      const blob = await exportEncryptedPrivateKey(privateKey, pwd);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chatforia-key.backup.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notifications.show({
        color: 'green',
        message: t('profile.backupDownloaded', 'Backup downloaded'),
      });
    } catch (e) {
      console.error(e);
      notifications.show({
        color: 'red',
        message: t('profile.exportFailed', 'Export failed'),
      });
    }
  };

  const importKey = async (file) => {
    try {
      if (!file) return;
      const pwd = window.prompt(
        t('profile.enterBackupPassword', 'Enter your backup password')
      );
      if (!pwd) return;
      const privateKeyB64 = await importEncryptedPrivateKey(file, pwd);
      const existing = await loadKeysLocal();
      await saveKeysLocal({ publicKey: existing.publicKey, privateKey: privateKeyB64 });
      notifications.show({
        color: 'green',
        message: t('profile.importSuccess', 'Backup imported successfully'),
      });
      if (importFileRef.current) importFileRef.current.value = null;
    } catch (e) {
      console.error(e);
      notifications.show({
        color: 'red',
        message: t('profile.importFailed', 'Import failed'),
      });
    }
  };

  const rotateKeys = async () => {
    try {
      const kp = generateKeypair();
      await saveKeysLocal(kp);
      await axiosClient.post('/users/keys', { publicKey: kp.publicKey });
      setCurrentUser((prev) => ({ ...prev, publicKey: kp.publicKey }));
      notifications.show({
        color: 'green',
        message: t('profile.keysRotated', 'Keys rotated'),
      });
    } catch (e) {
      console.error(e);
      notifications.show({
        color: 'red',
        message: t('profile.rotateFailed', 'Key rotation failed'),
      });
    }
  };

  /* ---------- early-return branches ---------- */

  if (viewingAnother) {
    return (
      <Paper withBorder shadow="sm" radius="xl" p="lg" maw={560} mx="auto">
        {loadingView ? (
          <Group align="center" justify="center" mih={120}>
            <Loader />
          </Group>
        ) : viewUser ? (
          <Stack gap="md">
            <Group align="center" justify="space-between">
              <Group>
                <Avatar
                  src={getAvatarSrc(viewUser)}
                  alt={t('profile.avatarAlt', 'Avatar')}
                  size={64}
                  radius="xl"
                />
                <div>
                  <Title order={3}>
                    {viewUser.username ||
                      t('profile.userFallback', 'User #{{id}}', { id: viewUser.id })}
                  </Title>
                  <Group gap="xs" mt={4}>
                    <Badge variant="light">
                      {(followStats?.followerCount ?? 0)}{' '}
                      {t('profile.followers', 'followers')}
                    </Badge>
                    <Badge variant="light">
                      {(followStats?.followingCount ?? 0)}{' '}
                      {t('profile.following', 'following')}
                    </Badge>
                    {followStats?.doTheyFollowMe ? (
                      <Badge color="blue" variant="light">
                        {t('profile.followsYou', 'Follows you')}
                      </Badge>
                    ) : null}
                  </Group>
                </div>
              </Group>
              <Group>
                {followStats?.amIFollowing ? (
                  <Button variant="light" color="red" loading={followBusy} onClick={doUnfollow}>
                    {t('profile.unfollow', 'Unfollow')}
                  </Button>
                ) : (
                  <Button variant="filled" loading={followBusy} onClick={doFollow}>
                    {t('profile.follow', 'Follow')}
                  </Button>
                )}
              </Group>
            </Group>
            <Text c="dimmed" size="sm">
              {t(
                'profile.followHint',
                'Their stories will appear in your Following feed if they post with audience Followers (or Public).'
              )}
            </Text>
          </Stack>
        ) : (
          <Text c="dimmed">{t('profile.userNotFound', 'User not found')}</Text>
        )}
      </Paper>
    );
  }

  if (!currentUser) {
    return (
      <Text c="dimmed">
        {t('profile.mustLogin', 'You must sign in to view the settings.')}
      </Text>
    );
  }

  /* ---------- main render ---------- */

  return (
    <Paper withBorder shadow="sm" radius="xl" p="lg" pb={80} maw={640} mx="auto">
      <Group justify="space-between" align="center" mb="md">
        <Title order={3}>{t('profile.title', 'User Profile')}</Title>
      </Group>

      <Accordion
        multiple
        variant="separated"
        radius="md"
        value={openItems}
        onChange={setOpenItems}
      >
        {/* Profile */}
        <Accordion.Item value="profile">
          <Accordion.Control>
            {t('profile.sectionProfile', 'Profile')}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Group align="center">
                <Avatar
                  src={getAvatarSrc(currentUser)}
                  alt={t('profile.avatarAlt', 'Avatar')}
                  size={64}
                  radius="xl"
                />
                <Stack gap={4}>
                  <FileInput
                    accept="image/*"
                    leftSection={<IconUpload size={16} />}
                    aria-label={t('profile.uploadAvatar', 'Upload avatar')}
                    placeholder={t('profile.uploadAvatar', 'Upload avatar')}
                    onChange={handleAvatarUpload}
                    disabled={avatarUploading}
                  />
                  {avatarUploading && (
                    <Group gap="xs">
                      <Loader size="xs" />
                      <Text size="xs" c="dimmed">
                        {t('profile.uploadingAvatar', 'Uploading avatar…')}
                      </Text>
                    </Group>
                  )}
                </Stack>
              </Group>
              {avatarError && (
                <Text size="xs" c="red">
                  {avatarError}
                </Text>
              )}
              
              <LanguageSelector
                currentLanguage={preferredLanguage || 'en'}
                onChange={async (lng) => {
                  setPreferredLanguage(lng);
                  setCurrentUser((prev) => ({ ...prev, preferredLanguage: lng }));
                  await i18n.changeLanguage(lng);
                  localStorage.setItem('preferredLanguage', lng);

                  try {
                    await axiosClient.patch(`/users/me`, { preferredLanguage: lng });
                  } catch (err) {
                    console.error('Failed to update language preference', err);
                  }
                }}
              />

              <Switch
                checked={autoTranslate}
                onChange={(e) => setAutoTranslate(e.currentTarget.checked)}
                label={t('profile.autoTranslate', 'Auto-translate messages')}
                aria-label={t('profile.autoTranslate', 'Auto-translate messages')}
              />
              <Switch
                checked={showOriginalWithTranslation}
                onChange={(e) =>
                  setShowOriginalWithTranslation(e.currentTarget.checked)
                }
                label={t(
                  'profile.showOriginalAndTranslation',
                  'Show original alongside translation'
                )}
                aria-label={t(
                  'profile.showOriginalAndTranslation',
                  'Show original alongside translation'
                )}
              />

              <Switch
                checked={showReadReceipts}
                onChange={(e) => setShowReadReceipts(e.currentTarget.checked)}
                label={t('profile.enableReadReceipts', 'Enable read receipts')}
                aria-label={t('profile.enableReadReceipts', 'Enable read receipts')}
              />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* My plan */}
        <Accordion.Item value="plan">
          <Accordion.Control>
            {t('profile.planSection', 'My plan')}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              {planLoading && (
                <Group>
                  <Loader size="sm" />
                  <Text size="sm">
                    {t('profile.planLoading', 'Loading your plan…')}
                  </Text>
                </Group>
              )}

              {planError && !planLoading && (
                <Text size="sm" c="red">
                  {planError}
                </Text>
              )}

              {!planLoading && planInfo && (
                <Card withBorder radius="lg" p="md">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Text size="sm" c="dimmed">
                        {t('profile.currentPlan', 'Current plan')}
                      </Text>

                      <Group gap="xs" mt={4}>
                        <Title order={4}>
                          {planInfo.label || 'Chatforia Free'}
                        </Title>
                        {!planInfo.isFree && planInfo.status && (
                          <Badge variant="light">
                            {planInfo.status}
                          </Badge>
                        )}
                      </Group>

                      {!planInfo.isFree && (
                        <Text size="sm" mt="xs">
                          {planInfo.amountFormatted}{' '}
                          {planInfo.currency?.toUpperCase()}/
                          {planInfo.interval || 'month'}
                        </Text>
                      )}

                      {planInfo.renewsAt && (
                        <Text size="xs" c="dimmed" mt="xs">
                          {t('profile.planRenewsOn', 'Renews on')}{' '}
                          {new Date(planInfo.renewsAt).toLocaleDateString()}
                        </Text>
                      )}

                      {planInfo.isFree && (
                        <Text size="sm" c="dimmed" mt="xs">
                          {t(
                            'profile.freePlanCopy',
                            'You’re on the free plan. Upgrade to unlock more features like backups, extra numbers, and advanced privacy options.'
                          )}
                        </Text>
                      )}
                    </div>

                    <Stack gap="xs">
                      <Button
                        size="xs"
                        radius="xl"
                        onClick={() => navigate('/upgrade')}
                        variant={planInfo.isFree ? 'filled' : 'outline'}
                      >
                        {planInfo.isFree
                          ? t('profile.upgradePlanCta', 'Upgrade plan')
                          : t('profile.changePlanCta', 'Change plan')}
                      </Button>

                      <Button
                        size="xs"
                        radius="xl"
                        variant="subtle"
                        onClick={openBillingPortal}
                        loading={portalBusy}
                      >
                        {t('profile.manageBilling', 'Manage billing')}
                      </Button>
                    </Stack>
                  </Group>
                </Card>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Phone number */}
        <Accordion.Item value="phone-number">
          <Accordion.Control>
            {t('profile.phoneNumber', 'Phone number')}
          </Accordion.Control>
          <Accordion.Panel>
            <PhoneNumberManager />
        
            {/* NEW: hint text about porting */}
            <Text size="sm" c="dimmed" mt="sm">
              {t(
                'profile.portHint',
                'Want to keep your current number? You can port it into Chatforia Wireless.'
              )}
            </Text>

            <Card withBorder radius="lg" p="md" mt="md">
              <Text fw={600}>
                {t('profile.esim.title', 'Chatforia eSIM')}
              </Text>
              <Text size="sm" c="dimmed" mt={4}>
                {hasEsim
                  ? t(
                      'profile.esim.descActive',
                      'Your Chatforia eSIM is active. You can view usage, re-scan your QR code, or manage your line in the Wireless dashboard.'
                    )
                  : t(
                      'profile.esim.desc',
                      'Get mobile data for Chatforia when you’re away from Wi-Fi.'
                    )}
              </Text>
              <Group justify="flex-start" mt="sm">
                <Button
                  onClick={() => navigate('/account/esim')}
                  variant="filled"
                  aria-label={
                    hasEsim
                      ? t('profile.esim.ctaManage', 'Manage eSIM / Show QR')
                      : t('profile.esim.cta', 'Get eSIM / Show QR')
                  }
                >
                  {hasEsim
                    ? t('profile.esim.ctaManage', 'Manage eSIM / Show QR')
                    : t('profile.esim.cta', 'Get eSIM / Show QR')}
                </Button>
              </Group>
            </Card>

            <Group mt="md" gap="xs">
              <Button
                variant="light"
                size="xs"
                onClick={() => navigate('/wireless')}
              >
                {t('profile.wireless.manage', 'Manage wireless')}
              </Button>

              <Button
                variant="outline"
                size="xs"
                onClick={() => navigate('/wireless/manage', { state: { scrollTo: 'port-number' } })
                }
              >
                {t('profile.wireless.portCta', 'Port my number')}
              </Button>
            </Group>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Voicemail */}
        <Accordion.Item value="voicemail">
          <Accordion.Control>
            {t('profile.voicemailSection', 'Voicemail')}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Switch
                checked={voicemailEnabled}
                onChange={(e) => setVoicemailEnabled(e.currentTarget.checked)}
                label={t('profile.voicemailEnabled', 'Enable voicemail')}
              />

              <NumberInput
                label={t(
                  'profile.voicemailAutoDeleteDays',
                  'Auto-delete voicemails after (days)'
                )}
                placeholder={t(
                  'profile.voicemailAutoDeletePlaceholder',
                  'Leave empty to keep forever'
                )}
                min={1}
                max={3650}
                value={voicemailAutoDeleteDays ?? ''}
                onChange={(v) =>
                  setVoicemailAutoDeleteDays(
                    v === '' || v === null ? null : Number(v) || null
                  )
                }
              />

              <TextInput
                label={t(
                  'profile.voicemailForwardEmail',
                  'Forward voicemail to email'
                )}
                placeholder={t(
                  'profile.voicemailForwardEmailPlaceholder',
                  'Email to send voicemail notifications to'
                )}
                value={voicemailForwardEmail}
                onChange={(e) => setVoicemailForwardEmail(e.currentTarget.value)}
              />

              <Textarea
                label={t(
                  'profile.voicemailGreetingText',
                  'Text fallback greeting'
                )}
                description={t(
                  'profile.voicemailGreetingTextDesc',
                  'Used when your audio greeting is unavailable.'
                )}
                minRows={2}
                value={voicemailGreetingText}
                onChange={(e) => setVoicemailGreetingText(e.currentTarget.value)}
              />

              <Group align="flex-end" gap="sm">
                <FileInput
                  accept="audio/*"
                  leftSection={<IconUpload size={16} />}
                  aria-label={t(
                    'profile.voicemailGreetingUpload',
                    'Upload voicemail greeting'
                  )}
                  placeholder={t(
                    'profile.voicemailGreetingUpload',
                    'Upload voicemail greeting'
                  )}
                  onChange={handleVoicemailGreetingUpload}
                  disabled={voicemailGreetingUploading}
                />
                {currentUser.voicemailGreetingUrl && (
                  <Button
                    variant="subtle"
                    component="a"
                    href={currentUser.voicemailGreetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="xs"
                  >
                    {t('profile.voicemailPreviewGreeting', 'Preview greeting')}
                  </Button>
                )}
              </Group>

              <Text size="xs" c="dimmed">
                {t(
                  'profile.voicemailNote',
                  'Voicemails from your Chatforia numbers will be stored in your Voicemail inbox. You can enable transcription and forwarding in supported plans.'
                )}
              </Text>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Appearance */}
        <Accordion.Item value="appearance">
          <Accordion.Control>
            {t('profile.appearance', 'Appearance')}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              {!isPremiumPlan && (
                <Card withBorder radius="lg" p="sm">
                  <Text size="sm" c="blue.6">
                    {t(
                      'profile.themeFreeNotice',
                      'You’re on Free—use the quick Sun/Moon options below. Upgrade to unlock more themes.'
                    )}
                  </Text>
                </Card>
              )}

              <Group gap="xs">
                <button
                  type="button"
                  className="theme-chip theme-chip--sun"
                  onClick={() => applyTheme('dawn')}
                  aria-label={t('profile.sunTheme', 'Use Dawn theme')}
                  title={t('profile.sunTheme', 'Use Dawn theme')}
                >
                  <IconSun size={18} />
                  <span>{t('profile.sun', 'Sun')}</span>
                </button>

                <button
                  type="button"
                  className="theme-chip theme-chip--moon"
                  onClick={() => applyTheme('midnight')}
                  aria-label={t('profile.moonTheme', 'Use Moon (Midnight) theme')}
                  title={t('profile.moonTheme', 'Use Moon (Midnight) theme')}
                >
                  <IconMoon size={18} />
                  <span>{t('profile.moon', 'Moon')}</span>
                </button>
              </Group>

              <ThemeSelect isPremium={canSeePremiumThemes} hideFreeOptions />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Sounds */}
        <Accordion.Item value="sounds">
          <Accordion.Control>
            {t('profile.soundSettings', 'Sounds')}
          </Accordion.Control>
          <Accordion.Panel>
            <SoundSettings />
          </Accordion.Panel>
        </Accordion.Item>

        {/* Disappearing messages */}
        <Accordion.Item value="disappearing">
          <Accordion.Control>
            {t('profile.disappearing', 'Disappearing messages')}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Switch
                checked={autoDeleteSeconds > 0}
                onChange={(e) =>
                  setAutoDeleteSeconds(e.currentTarget.checked ? 10 : 0)
                }
                label={t(
                  'profile.disappearingMessages',
                  'Enable disappearing messages'
                )}
              />
              {autoDeleteSeconds > 0 && (
                <>
                  <NumberInput
                    min={1}
                    step={1}
                    value={autoDeleteSeconds}
                    onChange={(val) => setAutoDeleteSeconds(Number(val) || 0)}
                    placeholder={t(
                      'profile.autoDeleteSeconds',
                      'Seconds until delete'
                    )}
                    clampBehavior="strict"
                  />
                  <PremiumGuard silent>
                    <AdvancedTtlControls
                      value={autoDeleteSeconds}
                      onChange={setAutoDeleteSeconds}
                    />
                  </PremiumGuard>
                </>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Backup & Sync (Premium) */}
        <Accordion.Item value="backup">
          <Accordion.Control>
            {t('profile.backupSync', 'Backup & Sync')}
          </Accordion.Control>
          <Accordion.Panel>
            <PremiumGuard>
              <Card withBorder radius="lg" p="md">
                <Group justify="space-between" align="center">
                  <Group>
                    <IconCloudUpload size={20} />
                    <Text fw={600}>
                      {t(
                        'profile.encryptedBackupsTitle',
                        'Encrypted Backups & Device Sync'
                      )}
                    </Text>
                  </Group>
                  <Button
                    variant="light"
                    component="a"
                    href="/settings/backups"
                    aria-label={t(
                      'profile.openBackupTools',
                      'Open Backup Tools'
                    )}
                  >
                    {t('profile.openBackupTools', 'Open Backup Tools')}
                  </Button>
                </Group>
                <Text size="sm" c="dimmed" mt="xs">
                  {t(
                    'profile.backupDesc',
                    'Create password-protected backups of your keys, and restore on another device to sync.'
                  )}
                </Text>
              </Card>
            </PremiumGuard>
          </Accordion.Panel>
        </Accordion.Item>

        {/* AI */}
        <Accordion.Item value="ai">
          <Accordion.Control>{t('profile.ai', 'AI')}</Accordion.Control>
          <Accordion.Panel>
            <SectionBoundary
              fallbackText={t(
                'profile.aiFailed',
                'AI settings failed to load'
              )}
            >
              <Suspense fallback={null}>
                <LazyAISettings />
              </Suspense>
            </SectionBoundary>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Accessibility */}
        <Accordion.Item value="accessibility">
          <Accordion.Control>
            {t('profile.accessibility', 'Accessibility')}
          </Accordion.Control>
          <Accordion.Panel>
            <SectionBoundary
              fallbackText={t(
                'profile.accessibilityFailed',
                'Accessibility settings failed to load'
              )}
            >
              <Suspense fallback={null}>
                <LazySettingsAccessibility />
              </Suspense>
            </SectionBoundary>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Privacy */}
        <Accordion.Item value="privacy">
          <Accordion.Control>
            {t('profile.privacy', 'Privacy')}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <PrivacySection />

              <Switch
                checked={allowExplicitContent}
                onChange={(e) =>
                  setAllowExplicitContent(e.currentTarget.checked)
                }
                label={t(
                  'profile.allowExplicitContent',
                  'Allow explicit content'
                )}
                aria-label={t(
                  'profile.allowExplicitContent',
                  'Allow explicit content'
                )}
              />

              <Switch
                checked={privacyBlurEnabled}
                onChange={(e) =>
                  setPrivacyBlurEnabled(e.currentTarget.checked)
                }
                label={t(
                  'profile.privacyBlurEnabled',
                  'Blur messages by default'
                )}
              />
              <Switch
                checked={privacyBlurOnUnfocus}
                onChange={(e) =>
                  setPrivacyBlurOnUnfocus(e.currentTarget.checked)
                }
                label={t(
                  'profile.privacyBlurOnUnfocus',
                  'Blur when app is unfocused'
                )}
              />
              <Switch
                checked={privacyHoldToReveal}
                onChange={(e) =>
                  setPrivacyHoldToReveal(e.currentTarget.checked)
                }
                label={t('profile.holdToReveal', 'Hold to reveal')}
              />
              <Switch
                checked={notifyOnCopy}
                onChange={(e) => setNotifyOnCopy(e.currentTarget.checked)}
                label={t(
                  'profile.notifyOnCopy',
                  'Notify me if my message is copied'
                )}
              />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Random Chat */}
        <Accordion.Item value="random-chat">
          <Accordion.Control>
            {t('profile.randomChat', 'Random Chat')}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Select
                label={t('profile.ageBand', 'Your age range')}
                placeholder={t(
                  'profile.ageBandPlaceholder',
                  'Select your age range'
                )}
                value={ageBand}
                onChange={setAgeBand}
                data={[
                  { value: 'TEEN_13_17', label: t('profile.ageTeen', '13–17') },
                  {
                    value: 'ADULT_18_24',
                    label: t('profile.age18_24', '18–24'),
                  },
                  {
                    value: 'ADULT_25_34',
                    label: t('profile.age25_34', '25–34'),
                  },
                  {
                    value: 'ADULT_35_49',
                    label: t('profile.age35_49', '35–49'),
                  },
                  {
                    value: 'ADULT_50_PLUS',
                    label: t('profile.age50Plus', '50+'),
                  },
                ]}
                withAsterisk
              />

              <Text size="xs" c="dimmed">
                {t(
                  'profile.ageBandHint',
                  'We only store an age range (not your exact date of birth). This is used to keep Random Chat pairings reasonable.'
                )}
              </Text>

              <Switch
                checked={wantsAgeFilter}
                onChange={(e) => setWantsAgeFilter(e.currentTarget.checked)}
                label={t(
                  'profile.wantsAgeFilter',
                  'Use age-based matching in Random Chat'
                )}
                description={t(
                  'profile.wantsAgeFilterDesc',
                  'When on, we try to pair you with people in compatible age ranges.'
                )}
                disabled={!ageBand}
              />

              {ageBand && ageBand !== 'TEEN_13_17' && (
                <MultiSelect
                  label={t(
                    'profile.partnerAgeBands',
                    'Who can you be matched with?'
                  )}
                  description={t(
                    'profile.partnerAgeBandsDesc',
                    'Teens are always matched only with other teens. Adults cannot be matched with teens.'
                  )}
                  value={randomChatAllowedBands}
                  onChange={setRandomChatAllowedBands}
                  data={[
                    {
                      value: 'ADULT_18_24',
                      label: t('profile.age18_24', '18–24'),
                    },
                    {
                      value: 'ADULT_25_34',
                      label: t('profile.age25_34', '25–34'),
                    },
                    {
                      value: 'ADULT_35_49',
                      label: t('profile.age35_49', '35–49'),
                    },
                    {
                      value: 'ADULT_50_PLUS',
                      label: t('profile.age50Plus', '50+'),
                    },
                  ]}
                  disabled={!wantsAgeFilter}
                />
              )}

              {ageBand === 'TEEN_13_17' && (
                <Text size="sm" c="dimmed">
                  {t(
                    'profile.teenMatchingNote',
                    'For safety, accounts in the 13–17 age range can only be matched with other 13–17 accounts in Random Chat.'
                  )}
                </Text>
              )}

              <Switch
                checked={foriaRemember}
                onChange={(e) => setForiaRemember(e.currentTarget.checked)}
                label={t(
                  'profile.foriaRemember',
                  'Let Foria remember things you tell it'
                )}
                description={t(
                  'profile.foriaRememberDesc',
                  'When this is on, Foria can use your past Random Chat conversations (just with you) to keep the conversation flowing. You can turn this off any time.'
                )}
              />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Security */}
        <Accordion.Item value="security">
          <Accordion.Control>
            {t('profile.security', 'Security')}
          </Accordion.Control>
          <Accordion.Panel>
            <TwoFASection user={currentUser} onChange={refreshAuthUser} />
            <Group mt="md">
              <Button
                variant="light"
                onClick={exportKey}
                aria-label={t('profile.exportKey', 'Export key')}
              >
                {t('profile.exportKey', 'Export key')}
              </Button>
              <FileInput
                ref={importFileRef}
                accept="application/json"
                aria-label={t('profile.importKey', 'Import key')}
                placeholder={t('profile.importKey', 'Import key')}
                onChange={importKey}
              />
              <Button
                color="orange"
                variant="light"
                onClick={rotateKeys}
                aria-label={t('profile.rotateKeys', 'Rotate keys')}
              >
                {t('profile.rotateKeys', 'Rotate keys')}
              </Button>
            </Group>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Devices */}
        <Accordion.Item value="devices">
          <Accordion.Control>
            {t('profile.devices', 'Linked devices')}
          </Accordion.Control>
          <Accordion.Panel>
            <LinkedDevicesPanel />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <Divider my="lg" />
      <div id="forwarding" ref={forwardingAnchorRef} style={{ scrollMarginTop: 16 }}>
        <Title order={4} mb="xs">
          {t('profile.forwarding', 'Call & Text Forwarding')}
        </Title>
        <ForwardingSettings />
      </div>

      <Group justify="flex-end" mt="xl">
        <Button onClick={saveSettings}>
          {t('profile.saveProfile', 'Save profile')}
        </Button>
      </Group>
    </Paper>
  )
}
