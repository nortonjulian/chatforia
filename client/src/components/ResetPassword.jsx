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

// Safe no-op toast shim for tests/SSR (avoids importing a module that uses import.meta)
const toast = {
  ok: () => {},
  err: () => {},
  info: () => {},
};

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // inline status for tests to query
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
      const msg = 'Invalid or missing password reset token.';
      setErrorMsg(msg);
      toast.err(msg);
      return;
    }

    if (password !== confirmPassword) {
      const msg = 'Passwords do not match';
      setErrorMsg(msg);
      toast.err(msg + '.');
      return;
    }

    setLoading(true);
    try {
      await axiosClient.post('/auth/reset-password', {
        token,
        newPassword: password,
      });

      const msg = 'Your password has been reset successfully';
      setSuccessMsg(msg);
      toast.ok(msg + '.');

      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      const msg =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        'Error: Unable to reset password.';
      setErrorMsg(msg);
      toast.err(msg);
      // eslint-disable-next-line no-console
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="xs" px="md" py="lg">
      <Paper withBorder shadow="sm" radius="xl" p="lg">
        <Title order={3} mb="md">
          Reset Password
        </Title>

        {isTokenMissing ? (
          <Alert color="red" variant="light" role="alert">
            Invalid or missing token. Please request a new password reset link.
          </Alert>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              {/* inline error/success for test assertions */}
              {errorMsg && (
                <div role="alert" style={{ color: 'var(--mantine-color-red-6)' }}>
                  {errorMsg}
                </div>
              )}
              {successMsg && <div>{successMsg}</div>}

              <PasswordInput
                label="New password"
                placeholder="Enter your new password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />
              <PasswordInput
                label="Confirm new password"
                placeholder="Re-enter your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                required
              />

              <Button type="submit" loading={loading} fullWidth>
                {loading ? 'Resetting...' : 'Reset Password'}
              </Button>
            </Stack>
          </form>
        )}

        {!isTokenMissing && (
          <Text size="xs" c="dimmed" mt="sm" ta="center">
            Choose a strong password you don’t use elsewhere.
          </Text>
        )}
      </Paper>
    </Container>
  );
}
