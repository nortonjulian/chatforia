import { useState } from 'react';
import {
  Container,
  Title,
  Text,
  Anchor,
  TextInput,
  Textarea,
  Button,
  Group,
  Alert,
  Stack,
} from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import { useTranslation } from 'react-i18next';

export default function ContactUs() {
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (submitting || !name.trim() || !email.trim() || !msg.trim()) return;
    setOk(false);
    setErr('');
    setSubmitting(true);

    try {
      await axiosClient.post('/support/tickets', {
        name: name.trim(),
        email: email.trim(),
        message: msg.trim(),
      });
      setOk(true);
      setName('');
      setEmail('');
      setMsg('');
    } catch (e) {
      setErr(
        t(
          'contact.errorSend',
          'Could not send. Please email support@chatforia.com.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container size="sm" py="xl" w="100%">
      <Title order={1} mb="lg">
        {t('contact.title', 'Contact Us')}
      </Title>

      {ok && (
        <Alert color="green" mb="sm">
          {t('contact.successMsg', 'Thanks—our team will reply by email.')}
        </Alert>
      )}

      {err && (
        <Alert color="red" mb="sm">
          {err}
        </Alert>
      )}

      <Text mb="lg" c="dimmed">
        {t('contact.intro', 'Tell us what happened and how we can help. Please do not include passwords or verification codes.')}
        {' '}<Anchor href="mailto:support@chatforia.com">support@chatforia.com</Anchor>
      </Text>
      <form onSubmit={submit}>
      <Stack gap="sm">
        <TextInput
          size="lg"
          radius="xl"
          label={t('contact.form.nameLabel', 'Name')}
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />

        <TextInput
          size="lg"
          radius="xl"
          label={t('contact.form.emailLabel', 'Email')}
          required
          autoComplete="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />

        <Textarea
          size="lg"
          radius="xl"
          label={t('contact.form.messageLabel', 'Message')}
          required
          autosize
          minRows={5}
          value={msg}
          onChange={(e) => setMsg(e.currentTarget.value)}
        />
      </Stack>

      <Group justify="flex-end" mt="md">
        <Button type="submit" disabled={!name.trim() || !email.trim() || !msg.trim()} loading={submitting} size="md" radius="xl">
          {t('contact.form.sendCta', 'Send')}
        </Button>
      </Group>
      </form>
    </Container>
  );
}
