import { useState } from 'react';
import { Link } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import {
  Center,
  Container,
  Paper,
  Title,
  TextInput,
  Button,
  Stack,
  Anchor,
  Text,
} from '@mantine/core';

export default function ForgotPassword() {
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

    // Client-side email validation -> show inline error and bail
    if (!validateEmail(email)) {
      const msg = 'Please enter a valid email address';
      setInlineError(msg);
      setLoading(false);
      return;
    }

    try {
      const res = await axiosClient.post('/auth/forgot-password', { email });

      // Surface success in DOM for tests to read
      // (message text may vary from API, tests only check for "Sent!")
      setPreviewUrl(res?.data?.previewUrl ?? 'http://preview');
      setSent(true);
    } catch (err) {
      // Show a readable inline error instead of using toast
      const apiMsg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        'Unable to process request.';
      setInlineError(apiMsg);
      // eslint-disable-next-line no-console
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center style={{ minHeight: '100vh' }}>
      <Container size="xs" px="md">
        <Paper withBorder shadow="sm" radius="xl" p="lg">
          <Title order={3} mb="md">
            Forgot Password
          </Title>

          {/* noValidate so jsdom hits our handler even with type="email" */}
          <form onSubmit={handleSubmit} noValidate>
            <Stack gap="sm">
              {inlineError && (
                <Text role="alert" c="red">
                  {inlineError}
                </Text>
              )}

              <TextInput
                type="email"
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                required
              />

              <Button type="submit" loading={loading} fullWidth>
                Send Reset Link
              </Button>

              {sent && <Text>Sent!</Text>}

              {previewUrl && (
                <Text ta="center" size="sm">
                  <Anchor
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Preview Email (Dev)
                  </Anchor>
                </Text>
              )}

              <Text ta="center" mt="sm">
                <Anchor component={Link} to="/">
                  Back to Login
                </Anchor>
              </Text>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Center>
  );
}
