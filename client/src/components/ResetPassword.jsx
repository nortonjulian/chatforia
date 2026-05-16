import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import {
  Container,
  Paper,
  Title,
  PasswordInput,
  Button,
  Alert,
  Text,
  Stack,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';

const toast = {
  ok: () => {},
  err: () => {},
  info: () => {},
};

export default function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isTokenMissing, setIsTokenMissing] = useState(false);

  useEffect(() => {
    if (!token) setIsTokenMissing(true);
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setErrorMsg('');
    setSuccessMsg('');

    if (!token) {
      const msg = t('login.resetPassword.missingToken');
      setErrorMsg(msg);
      toast.err(msg);
      return;
    }

    if (password !== confirmPassword) {
      const msg = t('login.resetPassword.passwordMismatch');
      setErrorMsg(msg);
      toast.err(`${msg}.`);
      return;
    }

    setLoading(true);

    try {
      await axiosClient.post('/auth/reset-password', {
        token,
        newPassword: password,
      });

      const msg = t('login.resetPassword.success');
      setSuccessMsg(msg);
      toast.ok(`${msg}.`);

      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      const msg =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        t('login.resetPassword.genericError');

      setErrorMsg(msg);
      toast.err(msg);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="xs" px="md" py="lg">
      <Paper withBorder shadow="sm" radius="xl" p="lg">
        <Title order={3} mb="md">
          {t('login.resetPassword.title')}
        </Title>

        {isTokenMissing ? (
          <Alert color="red" variant="light" role="alert">
            {t('login.resetPassword.missingTokenHelper')}
          </Alert>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              {errorMsg && (
                <div role="alert" style={{ color: 'var(--mantine-color-red-6)' }}>
                  {errorMsg}
                </div>
              )}

              {successMsg && <div>{successMsg}</div>}

              <PasswordInput
                label={t('login.resetPassword.newPasswordLabel')}
                placeholder={t('login.resetPassword.newPasswordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />

              <PasswordInput
                label={t('login.resetPassword.confirmPasswordLabel')}
                placeholder={t('login.resetPassword.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                required
              />

              <Button type="submit" loading={loading} fullWidth>
                {loading
                  ? t('login.resetPassword.resetting')
                  : t('login.resetPassword.submit')}
              </Button>
            </Stack>
          </form>
        )}

        {!isTokenMissing && (
          <Text size="xs" c="dimmed" mt="sm" ta="center">
            {t('login.resetPassword.strongPasswordHint')}
          </Text>
        )}
      </Paper>
    </Container>
  );
}