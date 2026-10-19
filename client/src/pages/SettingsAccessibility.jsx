import { useEffect, useRef, useState } from 'react';
import { Switch, Title } from '@mantine/core';
import PremiumGuard from '../components/PremiumGuard';
import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';
import { useTranslation } from 'react-i18next';
import { applyInterfaceFont } from '../utils/interfaceFont';

const FONT_OPTIONS = ['sm', 'md', 'lg', 'xl'];
const A11Y_PATH = '/users/me/a11y';

export default function SettingsAccessibility() {
  const { t } = useTranslation();
  const { currentUser, setCurrentUser } = useUser();
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const savingRef = useRef(false);
  const prefsAccountRef = useRef(currentUser?.id);
  const mountedRef = useRef(true);

  // Drive UI from currentUser; no separate load call
  const [user, setUser] = useState(currentUser || null);
  const [prefs, setPrefs] = useState(() => projectPrefs(currentUser));
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(''); // shown only if !user

  // Keep in sync if currentUser changes
  useEffect(() => {
    if (currentUser) {
      setUser(currentUser);
      if (!savingRef.current || prefsAccountRef.current !== currentUser.id) setPrefs(projectPrefs(currentUser));
      prefsAccountRef.current = currentUser.id;
      setError('');
    } else {
      setUser(null);
      setError(t('accessibilitySettings.loadFailed', 'Failed to load settings'));
    }
  }, [currentUser, t]);

  const vibSupported = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  // Cancel any unsaved font preview when leaving the settings page.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      applyInterfaceFont(currentUserRef.current?.a11yUiFont);
    };
  }, []);

  async function savePref(field, value) {
    if (savingRef.current) return;
    const accountId = currentUser?.id;
    savingRef.current = true;
    setFieldErrors((m) => ({ ...m, [field]: '' }));
    setPrefs((p) => ({ ...p, [field]: value })); // optimistic
    if (field === 'a11yUiFont') applyInterfaceFont(value);
    setSaving(true);
    try {
      const body = { [field]: value };
      const { data } = await axiosClient.patch(A11Y_PATH, body);
      const serverUser = data?.user || null;
      if (currentUserRef.current?.id !== accountId) return;
      if (!serverUser || !Object.hasOwn(serverUser, field)) throw new Error('Save response did not confirm the setting');
      // Merge only the acknowledged field. A partial response must not reset
      // unrelated preferences or overwrite auth, entitlement or encryption state.
      const saved = { [field]: serverUser[field] };
      setCurrentUser((previous) => previous?.id === accountId ? { ...previous, ...saved } : previous);
      if (mountedRef.current) {
        setUser((u) => ({ ...(u || {}), ...saved }));
        setPrefs((p) => ({ ...p, ...saved }));
      }
    } catch (e) {
      if (!mountedRef.current || currentUserRef.current?.id !== accountId) return;
      const previous = projectPrefs(currentUserRef.current)[field];
      setPrefs((p) => ({ ...p, [field]: previous }));
      if (field === 'a11yUiFont') applyInterfaceFont(previous);
      const msg = readableAxiosError(e, t) || t('common.saveError', 'Save failed');
      setFieldErrors((m) => ({ ...m, [field]: msg }));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  // If we truly have no user, show the error; otherwise never show the red banner
  if (!user) {
    return (
      <div className="p-4">
        <Title order={3} className="mb-1">
          {t('accessibilitySettings.title', 'Accessibility & Alerts')}
        </Title>
        <div className="text-sm text-red-600">
          {error || t('accessibilitySettings.loadFailed', 'Failed to load settings')}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-accessibility p-4 max-w-3xl">
      <Title order={3} className="mb-1">
        {t('accessibilitySettings.title', 'Accessibility & Alerts')}
      </Title>
      <p className="text-gray-500 mb-4">
        {t(
          'accessibilitySettings.accessibilityDesc',
          'Options to make Chatforia easier to use without relying on sound.'
        )}
      </p>

      <fieldset disabled={saving} className="space-y-4" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Card>
          <CardTitle>{t('accessibilitySettings.interfaceFontSize', 'Interface font size')}</CardTitle>
          <SelectRow
            label={t('accessibilitySettings.interfaceFontSize', 'Interface font size')}
            options={FONT_OPTIONS.map((k) => ({
              value: k,
              label: t(`accessibilitySettings.${k}`, k),
            }))}
            value={prefs.a11yUiFont || 'md'}
            onChange={(v) => savePref('a11yUiFont', v)}
          />
          <FieldError msg={fieldErrors.a11yUiFont} />
          <div className="text-xs text-gray-500">
            {t(
              'accessibilitySettings.interfaceFontSizeHelp',
              'Starts at normal size. Increase if you prefer larger text in accessibility settings.'
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>{t('accessibilitySettings.notifications', 'Notifications')}</CardTitle>
          <SwitchRow
            label={t('accessibilitySettings.visualAlerts', 'Visual alerts for messages & calls')}
            desc={t(
              'accessibilitySettings.visualAlertsDesc',
              'Show banners and title blink so you don’t miss activity.'
            )}
            checked={!!prefs.a11yVisualAlerts}
            onChange={(v) => savePref('a11yVisualAlerts', v)}
            errorMsg={fieldErrors.a11yVisualAlerts}
          />
          <SwitchRow
            label={t('accessibilitySettings.vibrateOnNewShort', 'Vibrate on new messages (when supported)')}
            desc={
              vibSupported
                ? t('accessibilitySettings.vibrateOnNewDesc', 'Trigger device vibration with notifications.')
                : t('accessibilitySettings.vibrateOnNewDesc', 'Not supported on this device.')
            }
            checked={!!prefs.a11yVibrate}
            onChange={(v) => savePref('a11yVibrate', v)}
            disabled={!vibSupported}
            errorMsg={fieldErrors.a11yVibrate}
          />
          <SwitchRow
            label={t('accessibilitySettings.flashOnCallShort', 'Flash screen on incoming call')}
            desc={
              reduceMotion
                ? t('accessibilitySettings.flashOnCallDesc', 'Disabled due to system reduce-motion.')
                : t('accessibilitySettings.flashOnCallDesc', 'Brief bright flash when a call rings.')
            }
            checked={!!prefs.a11yFlashOnCall}
            onChange={(v) => savePref('a11yFlashOnCall', v)}
            disabled={reduceMotion}
            errorMsg={fieldErrors.a11yFlashOnCall}
          />
        </Card>

        <Card>
          <CardTitle>{t('accessibilitySettings.liveCaptions', 'Live captions (calls)')}</CardTitle>
          <PremiumGuard inline>
            <SwitchRow
              label={t(
                'accessibilitySettings.enableLiveCaptions',
                'Enable live captions'
              )}
              desc={t(
                'accessibilitySettings.liveCaptionsDescription',
                'Show captions of the other participant’s speech during calls. Requires Premium.'
              )}
              checked={!!prefs.a11yLiveCaptions}
              onChange={(v) => savePref('a11yLiveCaptions', v)}
              errorMsg={fieldErrors.a11yLiveCaptions}
            />
          </PremiumGuard>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <SelectRow
              label={t('accessibilitySettings.captionFontSize', 'Caption font size')}
              options={FONT_OPTIONS.map((k) => ({
                value: k,
                label: t(`accessibilitySettings.${k}`, k),
              }))}
              value={prefs.a11yCaptionFont || 'lg'}
              onChange={(v) => savePref('a11yCaptionFont', v)}
            />
            <FieldError msg={fieldErrors.a11yCaptionFont} />

            <SelectRow
              label={t('accessibilitySettings.captionBackground', 'Caption background')}
              options={['light', 'dark', 'transparent'].map((k) => ({
                value: k,
                label: t(`accessibilitySettings.${k}`, k),
              }))}
              value={prefs.a11yCaptionBg || 'dark'}
              onChange={(v) => savePref('a11yCaptionBg', v)}
            />
            <FieldError msg={fieldErrors.a11yCaptionBg} />
          </div>
        </Card>

        <Card>
          <CardTitle>{t('accessibilitySettings.voiceNotes', 'Voice notes')}</CardTitle>
          <SwitchRow
            label={t(
              'accessibilitySettings.autoTranscribeVoiceNotes',
              'Auto-transcribe voice notes'
            )}
            desc={t(
              'accessibilitySettings.autoTranscribeVoiceNotesDesc',
              'Attach a transcript to audio messages you receive.'
            )}
            checked={!!prefs.a11yVoiceNoteSTT}
            onChange={(v) => savePref('a11yVoiceNoteSTT', v)}
            errorMsg={fieldErrors.a11yVoiceNoteSTT}
          />
        </Card>

      </fieldset>

      <div className="pt-4 text-sm text-gray-500">
        {saving
          ? t('upgrade.checkout.redirecting', 'Saving…')
          : t('accessibilitySettings.changesSavedInstantly', 'Changes are saved instantly.')}
      </div>
    </div>
  );
}

/* ---------------- helpers & presentational ---------------- */

function projectPrefs(u) {
  if (!u) {
    return {
      a11yUiFont: 'md',
      a11yVisualAlerts: false,
      a11yVibrate: false,
      a11yFlashOnCall: false,
      a11yLiveCaptions: false,
      a11yVoiceNoteSTT: false,
      a11yCaptionFont: 'lg',
      a11yCaptionBg: 'dark',
    };
  }
  return {
    a11yUiFont: u.a11yUiFont ?? 'md',
    a11yVisualAlerts: !!u.a11yVisualAlerts,
    a11yVibrate: !!u.a11yVibrate,
    a11yFlashOnCall: !!u.a11yFlashOnCall,
    a11yLiveCaptions: !!u.a11yLiveCaptions,
    a11yVoiceNoteSTT: !!u.a11yVoiceNoteSTT,
    a11yCaptionFont: u.a11yCaptionFont || 'lg',
    a11yCaptionBg: u.a11yCaptionBg || 'dark',
  };
}

function readableAxiosError(e, t) {
  if (!e) return '';
  const status = e.response?.status;
  const msg = e.response?.data?.error || e.message;
  if (status === 401) return t('auth.login', 'Please sign in again.');
  if (status === 402) return t('premiumGuard.requiresPremium', 'Premium required.');
  if (status === 403) return t('profile.saveError', 'Not allowed.');
  if (status === 404) return t('help.search', 'Endpoint not found.');
  return msg || t('common.saveError', 'Save failed');
}

function FieldError({ msg }) {
  if (!msg) return null;
  return <div className="text-xs text-red-600 mt-1">{msg}</div>;
}

function Card({ children }) {
  return <div className="rounded-2xl border p-4 shadow-sm bg-white space-y-3">{children}</div>;
}
function CardTitle({ children }) {
  return <h2 className="font-medium">{children}</h2>;
}
function SwitchRow({ label, desc, checked, onChange, disabled, errorMsg }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {desc && <div className="text-xs text-gray-500">{desc}</div>}
        {errorMsg && <FieldError msg={errorMsg} />}
      </div>
      <Switch
        checked={!!checked}
        onChange={(e) => {
          e.stopPropagation?.();
          onChange(e.currentTarget.checked);
        }}
        disabled={disabled}
        aria-label={label}
        style={{ pointerEvents: 'auto' }}
      />
    </div>
  );
}
function SelectRow({ label, options, value, onChange }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border rounded-lg px-3 py-2"
      >
        {options.map((o) =>
          typeof o === 'string' ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          )
        )}
      </select>
    </label>
  );
}
