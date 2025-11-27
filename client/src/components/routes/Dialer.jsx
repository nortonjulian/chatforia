import { useState } from 'react';
import { Box, Group, Button, TextInput, Stack, Text, Divider } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { usePstnCall } from '@/hooks/usePstnCall';
import { useTwilioVoice } from '@/hooks/useTwilioVoice';

export default function Dialer() {
  const { t } = useTranslation();
  const [digits, setDigits] = useState('');

  // PSTN (alias call via Twilio → real phone network)
  const { placeCall, loading: pstnLoading, error: pstnError } = usePstnCall();

  // Browser-based Twilio Voice call
  const {
    startBrowserCall,
    ready: voiceReady,
    calling: browserCalling,
    error: voiceError,
  } = useTwilioVoice();

  const press = (d) => setDigits((s) => (s + d).slice(0, 32));
  const backspace = () => setDigits((s) => s.slice(0, -1));

  const handlePstnCall = async () => {
    const to = digits.trim();
    if (!to) return;
    await placeCall(to);
  };

  const handleBrowserCall = async () => {
    const to = digits.trim();
    if (!to || !voiceReady) return;
    await startBrowserCall(to);
  };

  const disabledNumber = !digits.trim();

  return (
    <Box p="md">
      <Text fw={700} mb="xs">
        {t('dialer.title', 'Calls')}
      </Text>

      <Text c="dimmed" size="sm" mb="md">
        {t(
          'dialer.subtitle',
          'Keypad & recents. (If you don’t use PSTN, start calls from a conversation header.)'
        )}
      </Text>

      {/* Display */}
      <TextInput
        value={digits}
        onChange={(e) => setDigits(e.currentTarget.value)}
        placeholder={t('dialer.enterNumber', 'Enter number')}
        size="lg"
        mb="xs"
        aria-label={t('dialer.enterNumberAria', 'Enter number')}
      />

      {(pstnError || voiceError) && (
        <Text c="red" size="xs" mb="sm">
          {pstnError || voiceError}
        </Text>
      )}

      {/* Keypad + actions */}
      <Stack gap={6} w={260}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['*', '0', '#']].map(
          (row, i) => (
            <Group key={i} gap={6}>
              {row.map((d) => (
                <Button
                  key={d}
                  variant="light"
                  onClick={() => press(d)}
                  style={{ width: 80 }}
                >
                  {d}
                </Button>
              ))}
            </Group>
          )
        )}

        {/* PSTN: Chatforia number → phone network */}
        <Group gap={6}>
          <Button
            color="green"
            onClick={handlePstnCall}
            style={{ flex: 1 }}
            loading={pstnLoading}
            disabled={disabledNumber || pstnLoading}
          >
            {t('dialer.call', 'Call')}
          </Button>
          <Button
            variant="default"
            onClick={backspace}
            title={t('dialer.backspace', 'Backspace')}
          >
            ⌫
          </Button>
        </Group>

        {/* Browser-based Twilio Voice call */}
        <Button
          variant="outline"
          onClick={handleBrowserCall}
          disabled={disabledNumber || !voiceReady || browserCalling}
        >
          {t('dialer.callBrowser', 'Call via browser')}
        </Button>
      </Stack>

      <Divider my="lg" />

      {/* Recents placeholder */}
      <Text fw={600} mb={6}>
        {t('dialer.recents', 'Recents')}
      </Text>
      <Text c="dimmed" size="sm">
        {t('dialer.noRecents', 'No recent calls yet.')}
      </Text>
    </Box>
  );
}
