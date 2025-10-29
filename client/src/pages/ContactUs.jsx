import { useState } from 'react';
import {
  Container,
  Title,
  TextInput,
  Textarea,
  Button,
  Group,
  Alert,
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

  const submit = async () => {
    setOk(false);
    setErr('');
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
      // use translated fallback string here too
      setErr(
        t(
          'contact.errorSend',
          'Could not send. Please email support@chatforia.com.'
        )
      );
    }
  };

  return (
    <Container size="sm" py="xl">
      <Title order={2} mb="md">
        {t('contact.title', 'Contact Us')}
      </Title>

      {ok && (
        <Alert color="green" mb="sm">
          {t(
            'contact.successMsg',
            'Thanks—our team will reply by email.'
          )}
        </Alert>
      )}

      {err && (
        <Alert color="red" mb="sm">
          {err}
        </Alert>
      )}

      <TextInput
        label={t('contact.form.nameLabel', 'Name')}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        mb="sm"
      />

      <TextInput
        label={t('contact.form.emailLabel', 'Email')}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.currentTarget.value)}
        mb="sm"
      />

      <Textarea
        label={t('contact.form.messageLabel', 'Message')}
        minRows={4}
        value={msg}
        onChange={(e) => setMsg(e.currentTarget.value)}
        mb="md"
      />

      <Group justify="flex-end">
        <Button onClick={submit}>
          {t('contact.form.sendCta', 'Send')}
        </Button>
      </Group>
    </Container>
  );
}
