import { useState } from 'react';
import {
  Container,
  Title,
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

  const submit = async () => {
    setOk(false);
    setErr('');
    setSubmitting(true);

    try {
      await axiosClient.post('/support/tickets', {
        name,
        email,
        message: msg,
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
    <Container size="sm" py="xl">
      <Title order={2} mb="lg">
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

      <Stack gap="sm">
        <TextInput
          size="lg"
          radius="xl"
          label={t('contact.form.nameLabel', 'Name')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />

        <TextInput
          size="lg"
          radius="xl"
          label={t('contact.form.emailLabel', 'Email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />

        <Textarea
          size="lg"
          radius="xl"
          label={t('contact.form.messageLabel', 'Message')}
          minRows={4}
          value={msg}
          onChange={(e) => setMsg(e.currentTarget.value)}
        />
      </Stack>

      <Group justify="flex-end" mt="md">
        <Button onClick={submit} loading={submitting} size="md" radius="xl">
          {t('contact.form.sendCta', 'Send')}
        </Button>
      </Group>
    </Container>
  );
}
