import { useState } from 'react';
import { Modal, TextInput, Button, Group } from '@mantine/core';

export default function PhoneVerifyModal({ opened, onClose, user }) {
  const [phone, setPhone] = useState(user?.phoneNumber ?? '');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState('enter'); // enter -> sent

  const start = async () => {
    await fetch('/auth/phone/start', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phoneNumber: phone }) });
    setStage('sent');
  };
  const verify = async () => {
    const r = await fetch('/auth/phone/verify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code }) });
    if ((await r.json()).ok) onClose(true);
  };

  return (
    <Modal opened={opened} onClose={() => onClose(false)} title="Verify your phone">
      {stage==='enter' && (
        <>
          <TextInput label="Phone number (E.164)" value={phone} onChange={(e)=>setPhone(e.currentTarget.value)} placeholder="+15551234567" />
          <Group mt="md" justify="end"><Button onClick={start}>Send code</Button></Group>
        </>
      )}
      {stage==='sent' && (
        <>
          <TextInput label="Verification code" value={code} onChange={(e)=>setCode(e.currentTarget.value)} placeholder="6-digit code" />
          <Group mt="md" justify="space-between">
            <Button variant="subtle" onClick={()=>setStage('enter')}>Change number</Button>
            <Button onClick={verify}>Verify</Button>
          </Group>
        </>
      )}
    </Modal>
  );
}
