import React, { useState } from 'react';
import { Paper, Title, TextInput, Button, Stack, Alert, Text } from '@mantine/core';
import PhoneField from '@/components/PhoneField'; // you already have this
import axios from '@/api/axiosClient';

export default function SmsConsentPage() {
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const handleStart = async () => {
    setMsg(null);
    if (!phone) return setMsg({ type: 'error', text: 'Enter phone number' });
    if (!consent) return setMsg({ type: 'error', text: 'Please consent to receive SMS.' });

    try {
      setLoading(true);
      // public endpoint that doesn't require authentication
      const { data } = await axios.post('/sms-consent/start', { phoneNumber: phone });
      if (data?.ok) {
        setMsg({ type: 'success', text: 'Verification code sent — check your phone.' });
      } else {
        setMsg({ type: 'error', text: 'Failed to send code. Try again later.' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: e?.response?.data?.error || e?.message || 'Send failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '48px auto', padding: 16 }}>
      <Paper radius="md" p="lg" withBorder>
        <Title order={3}>SMS Consent & Verification</Title>
        <Text size="sm" color="dimmed" mt="xs">
          Enter a phone number and consent to receive messages. This page is public — reviewers can
          verify that users opt in to SMS.
        </Text>

        <Stack mt="md">
          {msg && <Alert color={msg.type === 'error' ? 'red' : 'green'}>{msg.text}</Alert>}

          <PhoneField
            value={phone}
            onChange={(v) => setPhone(v || '')}
            defaultCountry="US"
            label="Phone number"
            required
          />

          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span style={{ fontSize: 14 }}>
              I consent to receive SMS messages from Chatforia for verification and demo purposes.
            </span>
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={handleStart} loading={loading}>
              Send verification code
            </Button>
          </div>

          <Text size="xs" color="dimmed">
            Message & data rates may apply. Reply STOP to opt out, HELP for help.
          </Text>
        </Stack>
      </Paper>
    </div>
  );
}