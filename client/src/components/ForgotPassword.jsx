import { useState } from 'react';
import { Link } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import { Title, TextInput, Button, Stack, Anchor, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function ForgotPassword() {
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [sent, setSent] = useState(false);

  const validateEmail = (val) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val).toLowerCase());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setPreviewUrl('');
    setInlineError('');
    setSent(false);

    if (!validateEmail(email)) {
      setInlineError(t('login.forgotPassword.emailInvalid'));
      setLoading(false);
      return;
    }

    try {
      const res = await axiosClient.post('/auth/forgot-password', { email });
      setPreviewUrl(res?.data?.previewUrl ?? 'http://preview');
      setSent(true);
    } catch (err) {
      const apiMsg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t('login.forgotPassword.genericError');

      setInlineError(apiMsg);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Title order={3} mb="xs">
        {t('login.forgotPassword.title')}
      </Title>

      <Text size="sm" c="dimmed" mb="md">
        {t('login.forgotPassword.helper')}
      </Text>

      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="sm">
          {inlineError && (
            <Text role="alert" c="red">
              {inlineError}
            </Text>
          )}

          <TextInput
            type="email"
            label={t('login.forgotPassword.emailLabel')}
            placeholder={t('login.forgotPassword.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
          />

          <Button type="submit" loading={loading} fullWidth>
            {loading
              ? t('login.forgotPassword.sending')
              : t('login.forgotPassword.sendCta')}
          </Button>

          {sent && (
            <>
              <Text>{t('login.forgotPassword.sentLabel')}</Text>
              <Text size="sm" c="dimmed">
                {t('login.forgotPassword.sentHelper')}
              </Text>
            </>
          )}

          {previewUrl && (
            <Text ta="center" size="sm">
              <Anchor href={previewUrl} target="_blank" rel="noopener noreferrer">
                {t('login.forgotPassword.previewDev')}
              </Anchor>
            </Text>
          )}

          <Text ta="center" mt="sm">
            <Anchor component={Link} to="/">
              {t('login.forgotPassword.backToLogin')}
            </Anchor>
          </Text>
        </Stack>
      </form>
    </>
  );
}