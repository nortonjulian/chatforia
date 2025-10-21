import { useEffect, useMemo, useState } from 'react';
import { Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import QRCode from 'react-qr-code';
import {
  deriveSharedKeyBrowser,
  sealWithKey,
} from '../../utils/cryptoProvisionClient.js';
// IMPORTANT: You must implement export of your local private key bundle.
// It should return an object like: { userPrivateKey: 'base64...', metadata: {...} }
import { exportLocalPrivateKeyBundle } from '../../utils/encryptionClient.js';

export default function LinkFlowPrimaryModal({ opened, onClose }) {
  const [step, setStep] = useState('idle'); // idle | ready | waitingClient | approving | sent | error
  const [error, setError] = useState('');
  const [link, setLink] = useState(null); // { linkId, qrPayload }
  const [sPub, setSPub] = useState('');

  useEffect(() => {
    let interval;
    if (opened) {
      (async () => {
        try {
          setError('');
          setStep('idle');
          // 1) create link
          const res = await fetch('/devices/provision/start', {
            method: 'POST',
            credentials: 'include',
          });
          const data = await res.json();
          setLink(data);
          setStep('ready');

          // 2) poll for client-init (sPub becomes available when new device calls client-init)
          interval = setInterval(async () => {
            try {
              const p = await fetch(
                `/devices/provision/poll?linkId=${encodeURIComponent(data.linkId)}`
              );
              const json = await p.json();
              if (json?.sPub) {
                setSPub(json.sPub);
                setStep('waitingClient');
              }
            } catch (_e) {
              // swallow polling errors; next tick may succeed
            }
          }, 1500);
        } catch (e) {
          setError(e?.message || 'Failed to start provisioning');
          setStep('error');
        }
      })();
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [opened]);

  const qrText = useMemo(
    () => (link?.qrPayload ? JSON.stringify(link.qrPayload) : ''),
    [link]
  );

  const approveAndSend = async () => {
    try {
      if (!link || !sPub) return;

      setStep('approving');
      // 3) export local key bundle (plaintext in memory only)
      const bundle = await exportLocalPrivateKeyBundle();

      // 4) derive shared key using secret + sPub (+ optional ePub not required here)
      const k = await deriveSharedKeyBrowser(link.qrPayload.secret, sPub, '');

      // 5) seal bundle and relay to server
      const sealed = sealWithKey(k, bundle); // { nonceB64, ciphertextB64 }

      await fetch('/devices/provision/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        body: JSON.stringify({
          linkId: link.linkId,
          ciphertext: sealed.ciphertextB64,
          nonce: sealed.nonceB64,
          sPub,
        }),
      });

      setStep('sent');
    } catch (e) {
      setError(e?.message || 'Failed to approve provisioning');
      setStep('error');
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Link a new device"
      centered
      size="lg"
    >
      {step === 'error' ? (
        <Stack gap="md">
          <Text c="red">
            {error || 'Failed to start provisioning'}
          </Text>
          <Group justify="end">
            <Button variant="default" onClick={onClose}>Close</Button>
          </Group>
        </Stack>
      ) : !link || step === 'idle' ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : (
        <Stack gap="md">
          <Text>
            On your new device, open Chatforia → “Link to existing account” and
            scan this code.
          </Text>
          <Group justify="center">
            <QRCode value={qrText} size={220} />
          </Group>
          <Text ta="center" c="dimmed">
            SAS code: <strong>{link?.qrPayload?.sas ?? ''}</strong> (confirm it matches
            on both devices)
          </Text>

          {error && <Text c="red">{error}</Text>}

          <Group justify="space-between" mt="sm">
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
            <Button
              disabled={!sPub || step === 'approving' || step === 'sent'}
              onClick={approveAndSend}
            >
              {step === 'sent'
                ? 'Sent ✓'
                : step === 'approving'
                ? 'Sending…'
                : 'Approve & Send Key'}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
