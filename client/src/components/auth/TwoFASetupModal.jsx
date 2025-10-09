import { useEffect, useState } from 'react';
import { Modal, Image, TextInput, Button, Stack, Code } from '@mantine/core';

export default function TwoFASetupModal({ opened, onClose }) {
  const [qr, setQr] = useState(null);
  const [tmpSecret, setTmpSecret] = useState(null);
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState([]);

  useEffect(() => {
    if (!opened) return;
    (async () => {
      const r = await fetch('/auth/2fa/setup', { method:'POST' });
      const j = await r.json();
      setQr(j.qrDataUrl); setTmpSecret(j.tmpSecret);
    })();
  }, [opened]);

  const enable = async () => {
    const r = await fetch('/auth/2fa/enable', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tmpSecret, code }) });
    const j = await r.json();
    if (j.ok) { setBackup(j.backupCodes); }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Enable 2-step verification">
      <Stack>
        {!backup.length && (
          <>
            {qr && <Image src={qr} alt="Scan QR" w={220} />}
            <TextInput label="Enter the 6-digit code" value={code} onChange={(e)=>setCode(e.currentTarget.value)} />
            <Button onClick={enable}>Enable</Button>
          </>
        )}
        {!!backup.length && (
          <>
            <div>Save these backup codes in a safe place:</div>
            <Stack gap={4}>{backup.map(c => <Code key={c}>{c}</Code>)}</Stack>
            <Button mt="md" onClick={onClose}>Done</Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}
