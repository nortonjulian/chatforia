import { useState } from 'react';
import { Container, Paper, Title, TextInput, Button, Text } from '@mantine/core';
import SmsConsentBlock from '@/pages/SmsConsentBlock';
import PhoneField from '@/components/PhoneField';
import axiosClient from '@/api/axiosClient';

export default function SmsConsentPage() {
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const isPhoneValid = (v) => {
    return /^\+\d{7,15}$/.test((v || '').trim());
  };

  async function onSubmit(e) {
    e?.preventDefault?.();
    setError('');
    setStatus('');

    if (!isPhoneValid(phone)) {
      setError('Please enter a valid phone number in international format (e.g. +14155551234).');
      return;
    }
    if (!consent) {
      setError('Please check the consent box to continue.');
      return;
    }

    try {
      setStatus('Sending verification…');

      // Server must enforce consent and rate-limit (see server checklist)
      await axiosClient.post('/auth/send-verify', { phone: phone.trim(), consent: true });

      setStatus('Verification code sent. Check your phone.');
    } catch (err) {
      setStatus('');
      setError(err?.response?.data?.message || 'Failed to send verification code. Try again later.');
    }
  }

  return (
    <Container size="md" py="xl">
      <Paper radius="md" p="lg" withBorder>
        <Title order={2}>SMS consent & verification</Title>

        <Text mt="md">
          By checking the box below and providing your phone number you agree to receive SMS messages from
          Chatforia related to your account and conversations (verification codes, login alerts, notifications). Message
          frequency may vary. Msg & data rates may apply. Reply <b>STOP</b> to opt out, <b>HELP</b> for help.
        </Text>

        <form onSubmit={onSubmit} style={{ marginTop: 18 }}>
          <PhoneField
            label="Phone number"
            value={phone}
            onChange={setPhone}
            defaultCountry="US"
            required
            error={error && !isPhoneValid(phone) ? error : undefined}
          />

          <SmsConsentBlock
            checked={consent}
            onChange={setConsent}
            termsUrl="/legal/terms"
            privacyUrl="/privacy"
            companyName="Chatforia"
          />

          <Button mt="md" type="submit" disabled={!consent || !isPhoneValid(phone)}>
            Send verification code
          </Button>

          {status && <Text mt="sm">{status}</Text>}
          {error && <Text color="red" mt="sm">{error}</Text>}

          <Text size="xs" mt="sm" color="dimmed">
            For support: <a href="mailto:support@chatforia.com">support@chatforia.com</a>
          </Text>
        </form>
      </Paper>
    </Container>
  );
}