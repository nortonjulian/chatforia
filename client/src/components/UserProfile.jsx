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
  const params = useParams();
  const viewUserId = params.userId ? Number(params.userId) : null;
  const viewingAnother = !!(viewUserId && currentUser && viewUserId !== currentUser.id);

  const importFileRef = useRef(null);
  const forwardingAnchorRef = useRef(null);

  const { setColorScheme } = useMantineColorScheme();
  const [themeNow, setThemeNow] = useState(getTheme());
  useEffect(() => onThemeChange(setThemeNow), []);
  useEffect(() => {
    const theme = getTheme();
    setColorScheme(isLightTheme(theme) ? 'light' : 'dark');
    setFaviconForTheme(theme);
  }, [setColorScheme]);

  const [coolCtasOnMidnight, setCoolCtasOnMidnight] = useState(
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-cta') === 'cool'
  );

  const applyTheme = (themeName) => {
    setTheme(themeName);
    setColorScheme(isLightTheme(themeName) ? 'light' : 'dark');
    setFaviconForTheme(themeName);
    if (themeName !== 'midnight') {
      document.documentElement.removeAttribute('data-cta');
      setCoolCtasOnMidnight(false);
    }
  };

  /* ------- view another user ------- */
  const [loadingView, setLoadingView] = useState(viewingAnother);
  const [viewUser, setViewUser] = useState(null);
  const [followStats, setFollowStats] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);

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

  const doFollow = async () => {
    try {
      setFollowBusy(true);
      await axiosClient.post(`/follows/${viewUserId}`);
      const { data: stats } = await axiosClient.get(`/follows/${viewUserId}/stats`);
      setFollowStats(stats);
      notifications.show({ color: 'green', message: t('profile.followed', 'Followed') });
    } catch (e) {
      console.error(e);
      notifications.show({
        color: 'red',
        message: t('profile.followFailed', 'Failed to follow'),
      });
    } finally {
      setFollowBusy(false);
    }
  };
  const doUnfollow = async () => {
    try {
      setFollowBusy(true);
      await axiosClient.delete(`/follows/${viewUserId}`);
      const { data: stats } = await axiosClient.get(`/follows/${viewUserId}/stats`);
      setFollowStats(stats);
      notifications.show({ color: 'green', message: t('profile.unfollowed', 'Unfollowed') });
    } catch (e) {
      console.error(e);
      notifications.show({
        color: 'red',
        message: t('profile.unfollowFailed', 'Failed to unfollow'),
      });
    } finally {
      setFollowBusy(false);
    }
  };

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
                  src={viewUser.avatarUrl || '/default-avatar.png'}
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

  /* ------- own profile ------- */
  if (!currentUser) {
    return (
      <Text c="dimmed">
        {t('profile.mustLogin', 'You must sign in to view the settings.')}
      </Text>
    );
  }

  const planUpper = (currentUser.plan || 'FREE').toUpperCase();
  const isPremiumPlan = planUpper === 'PREMIUM';
  const canSeePremiumThemes = isPremiumPlan || premiumPreviewEnabled();
  const hasEsim = Boolean(currentUser.tealIccid); // 👈 NEW: detect Teal eSIM on account

  // ✅ Defaults
  const [preferredLanguage, setPreferredLanguage] = useState(
    currentUser.preferredLanguage || 'en'
  );
  const [autoTranslate, setAutoTranslate] = useState(
    typeof currentUser.autoTranslate === 'boolean' ? currentUser.autoTranslate : false
  );
  const [showOriginalWithTranslation, setShowOriginalWithTranslation] = useState(
    typeof currentUser.showOriginalWithTranslation === 'boolean'
      ? currentUser.showOriginalWithTranslation
      : false
  );
  const [allowExplicitContent, setAllowExplicitContent] = useState(
    currentUser.allowExplicitContent ?? false
  );
  const [showReadReceipts, setShowReadReceipts] = useState(
    typeof currentUser.showReadReceipts === 'boolean'
      ? currentUser.showReadReceipts
      : false
  );
  const [autoDeleteSeconds, setAutoDeleteSeconds] = useState(
    currentUser.autoDeleteSeconds || 0
  );
  const [privacyBlurEnabled, setPrivacyBlurEnabled] = useState(
    currentUser.privacyBlurEnabled ?? false
  );
  const [privacyBlurOnUnfocus, setPrivacyBlurOnUnfocus] = useState(
    currentUser.privacyBlurOnUnfocus ?? false
  );
  const [privacyHoldToReveal, setPrivacyHoldToReveal] = useState(
    currentUser.privacyHoldToReveal ?? false
  );
  const [notifyOnCopy, setNotifyOnCopy] = useState(currentUser.notifyOnCopy ?? false);

  // 🔢 Age + Random Chat
  const [ageBand, setAgeBand] = useState(currentUser.ageBand || null);
  const [wantsAgeFilter, setWantsAgeFilter] = useState(
    typeof currentUser.wantsAgeFilter === 'boolean'
      ? currentUser.wantsAgeFilter
      : true
  );
  const [randomChatAllowedBands, setRandomChatAllowedBands] = useState(
    currentUser.randomChatAllowedBands || []
  );

  // 🧠 Foria memory toggle
  const [foriaRemember, setForiaRemember] = useState(
    typeof currentUser.foriaRemember === 'boolean'
      ? currentUser.foriaRemember
      : true
  );

  // Keep UI theme in sync if user state changes (e.g., login in another tab)
  useEffect(() => {
    if (currentUser?.theme) applyTheme(currentUser.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.theme]);

  // Nothing auto-opened
  const [openItems, setOpenItems] = useState([]);

  // If requested, scroll to forwarding section (which is outside the accordion)
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

  // Refresh auth user after 2FA changes
  const refreshAuthUser = async () => {
    try {
      const { data } = await axiosClient.get('/auth/me');
      if (data?.user) setCurrentUser((prev) => ({ ...prev, ...data.user }));
    } catch (e) {
      console.error('Failed to refresh /auth/me', e);
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
        // 👇 Age + Random Chat
        ageBand,
        wantsAgeFilter,
        randomChatAllowedBands,
        // 👇 Foria memory
        foriaRemember,
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
    const formData = new FormData();
    formData.append('file', file);
    try {
      const { data } = await axiosClient.post('/users/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (data.avatarUrl) {
        setCurrentUser((prev) => ({ ...prev, avatarUrl: data.avatarUrl }));
        notifications.show({
          color: 'green',
          message: t('profile.avatarSuccess', 'Avatar updated'),
        });
      } else {
        throw new Error('No avatarUrl returned');
      }
    } catch (err) {
      console.error('Avatar upload failed', err);
      notifications.show({
        color: 'red',
        message: t('profile.avatarError', 'Failed to upload avatar'),
      });
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

  return (
    <Paper withBorder shadow="sm" radius="xl" p="lg" maw={640} mx="auto">
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
                  src={currentUser.avatarUrl || '/default-avatar.png'}
                  alt={t('profile.avatarAlt', 'Avatar')}
                  size={64}
                  radius="xl"
                />
                <FileInput
                  accept="image/*"
                  leftSection={<IconUpload size={16} />}
                  aria-label={t('profile.uploadAvatar', 'Upload avatar')}
                  placeholder={t('profile.uploadAvatar', 'Upload avatar')}
                  onChange={handleAvatarUpload}
                />
              </Group>

              <LanguageSelector
                currentLanguage={currentUser.preferredLanguage || 'en'}
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

        {/* Phone number */}
        <Accordion.Item value="phone-number">
          <Accordion.Control>
            {t('profile.phoneNumber', 'Phone number')}
          </Accordion.Control>
          <Accordion.Panel>
            <PhoneNumberManager />

            <Card withBorder radius="lg" p="md" mt="md">
              <Text fw={600}>
                {t('profile.esim.title', 'Chatforia eSIM (Teal)')}
              </Text>
              <Text size="sm" c="dimmed" mt={4}>
                {hasEsim
                  ? t(
                      'profile.esim.descActive',
                      'Your Chatforia eSIM is active. You can view or re-scan your QR code, or manage your line.'
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

            <Group mt="md">
              <Button
                variant="light"
                size="xs"
                onClick={() => navigate('/family')}
              >
                {t('profile.family.manage', 'Manage Family plan')}
              </Button>
            </Group>
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

      <Group justify="flex-end" mt="md">
        <Button onClick={saveSettings}>{t('common.save', 'Save')}</Button>
      </Group>
    </Paper>
  );
}
