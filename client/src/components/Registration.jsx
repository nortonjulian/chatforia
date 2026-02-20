import { useState } from 'react';
import {
  Paper,
  Title,
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Alert,
  Text,
  Anchor,
} from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';
import { useNavigate } from 'react-router-dom';


import PhoneField from './PhoneField';
import SmsConsentBlock from './SmsConsentBlock';
import { isValidPhoneNumber } from 'react-phone-number-input';

export default function Registration() {
  const { t } = useTranslation();

  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    phone: '', // ✅ new
  });

  const [smsConsent, setSmsConsent] = useState(false); // ✅ new

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState('');

  const onChange = (key) => (e) => {
    const val = (e?.currentTarget?.value) ?? (e?.target?.value) ?? '';
    setForm((f) => ({ ...f, [key]: val }));
  };

  const validate = () => {
    const nxt = {};

    if (!form.username.trim()) nxt.username = 'Username is required';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()))
      nxt.email = 'Please enter a valid email address';

    if (!form.password) nxt.password = 'Password is required';
    else if (form.password.length < 6) nxt.password = 'Password must be at least 6 characters';

    // ✅ Phone is optional, but if provided must be valid AND consent must be checked
    const phoneTrim = (form.phone || '').trim();
    if (phoneTrim) {
      if (!isValidPhoneNumber(phoneTrim)) {
        nxt.phone = 'Please enter a valid phone number';
      }
      if (!smsConsent) {
        nxt.smsConsent = 'Please check the box to consent to SMS messages (or remove the phone number).';
      }
    }

    setErrors(nxt);
    return Object.keys(nxt).length === 0;
  };

  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    setGlobalError('');
    setErrors({});

    if (!validate()) return;

    const phoneTrim = (form.phone || '').trim();

    // If the user provided a phone number, route them to the consent screen first.
    if (phoneTrim) {
      // Pass the pending registration in location.state so the consent -> OTP -> verify flow
      // can resume registration after phone verification.
      // NOTE: location.state is in-memory only (lost on hard refresh). See notes below for persistence options.
      navigate('/verify-phone-consent', { state: { pendingRegistration: { ...form } } });
      return;
    }

    // Otherwise, no phone was provided — proceed directly with registration.
    try {
      setSubmitting(true);

      const payload = {
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        // no phone field
      };

      await axiosClient.post('/auth/register', payload);

      // on success: redirect to login / onboarding as desired
      // navigate('/welcome'); // uncomment and change as needed
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;

      if (status === 422) {
        const nxt = {};
        const fieldErrors = data?.fieldErrors || data?.errors;

        if (Array.isArray(fieldErrors)) {
          for (const e of fieldErrors) {
            const field = e?.field || e?.path || e?.name;
            if (field) nxt[field] = e?.message || 'Invalid value';
          }
        } else if (fieldErrors && typeof fieldErrors === 'object') {
          for (const [field, msg] of Object.entries(fieldErrors)) {
            nxt[field] = typeof msg === 'string' ? msg : (msg?.message || 'Invalid value');
          }
        } else if (typeof data?.message === 'string') {
          setGlobalError(data.message);
        } else {
          setGlobalError('Invalid input. Please check your details.');
        }

        if (Object.keys(nxt).length) setErrors(nxt);
      } else if (status === 409) {
        const code = data?.code;
        const nxt = {};
        if (code === 'USERNAME_TAKEN' || /username/i.test(data?.message || '')) {
          nxt.username = 'That username is already taken';
        }
        if (code === 'EMAIL_TAKEN' || /email/i.test(data?.message || '')) {
          nxt.email = 'That email is already in use';
        }
        if (!Object.keys(nxt).length) {
          setGlobalError(data?.message || 'Username or email already in use.');
        } else {
          setErrors(nxt);
        }
      } else if (status === 429) {
        setGlobalError('Too many attempts. Please try again later.');
      } else {
        setGlobalError(data?.message || 'Registration failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Paper withBorder shadow="sm" radius="xl" p="lg">
      <form onSubmit={onSubmit} style={{ maxWidth: 420, margin: '0 auto' }}>
        <Title order={3} mb="sm">
          {t('auth.registration.title', 'Create account')}
        </Title>

        <Stack>
          {globalError && (
            <Alert color="red" role="alert">
              {globalError}
            </Alert>
          )}
          {errors.email && (
            <Alert color="red" role="alert">
              {errors.email}
            </Alert>
          )}

          <TextInput
            label={t('auth.registration.usernameLabel', 'Username')}
            placeholder={t('auth.registration.usernamePlaceholder', 'your username')}
            required
            value={form.username}
            onChange={onChange('username')}
            error={errors.username}
            variant="filled"
            size="md"
            disabled={submitting}
            autoComplete="username"
          />

          <TextInput
            label={t('auth.registration.emailLabel', 'Email')}
            placeholder={t('auth.registration.emailPlaceholder', 'you@example.com')}
            required
            value={form.email}
            onChange={onChange('email')}
            error={errors.email}
            variant="filled"
            size="md"
            disabled={submitting}
            autoComplete="email"
          />

          <PasswordInput
            label={t('auth.registration.passwordLabel', 'Password')}
            placeholder={t('auth.registration.passwordPlaceholder', 'Your password')}
            required
            value={form.password}
            onChange={onChange('password')}
            error={errors.password}
            variant="filled"
            size="md"
            disabled={submitting}
            autoComplete="new-password"
            minLength={6}
          />

          {/* ✅ Phone + consent (phone optional, consent required if phone entered) */}
          <PhoneField
            label={t('auth.registration.phoneLabel', 'Phone (optional)')}
            value={form.phone}
            onChange={(val) => setForm((f) => ({ ...f, phone: val || '' }))}
            defaultCountry="US"
            required={false}
            disabled={submitting}
            error={errors.phone}
            helpText={t(
              'auth.registration.phoneHelp',
              'If you add a phone number, you’ll be asked to consent to SMS notifications.'
            )}
          />

          <SmsConsentBlock
            checked={smsConsent}
            onChange={setSmsConsent}
            disabled={submitting}
            error={errors.smsConsent}
            companyName="Chatforia"
            termsUrl="https://www.chatforia.com/terms"
            privacyUrl="https://www.chatforia.com/privacy"
          />

          <Button
            type="submit"
            loading={!!submitting}
            fullWidth
            aria-label={t('auth.registration.submitAria', 'Register')}
            disabled={submitting}
          >
            {t('auth.registration.submit', 'Create account')}
          </Button>

          {/* Optional extra legal links (fine to keep) */}
          <Text size="xs" mt={4}>
            <Anchor component={Link} to="/legal/terms">
              {t('auth.registration.termsLink', 'Terms of Service')}
            </Anchor>
            {' · '}
            <Anchor component={Link} to="/privacy">
              {t('auth.registration.privacyLink', 'Privacy Policy')}
            </Anchor>
          </Text>

          <Text size="sm" mt="md">
            {t('auth.registration.already', 'Already have an account?')}{' '}
            <Anchor component={Link} to="/login" fw={600} className="auth-inline-link">
              {t('auth.logIn', 'Log in')}
            </Anchor>
          </Text>
        </Stack>
      </form>
    </Paper>
  );
}