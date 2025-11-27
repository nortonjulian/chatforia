import { useState } from 'react';
import { Button, Stack } from '@mantine/core';
import PhoneField from './PhoneField';
import { usePstnCall } from '@/hooks/usePstnCall';

export default function PstnCallForm({
  defaultCountry = 'US',
  label = 'Call phone number',
}) {
  const [phone, setPhone] = useState('');
  const { placeCall, loading, error } = usePstnCall();

  const handleSubmit = async (e) => {
    e.preventDefault();
    await placeCall(phone); // phone is already E.164 from PhoneField
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="xs">
        <PhoneField
          label={label}
          value={phone}
          onChange={setPhone}
          defaultCountry={defaultCountry}
          required
          error={error || undefined}
        />
        <Button type="submit" loading={loading} disabled={!phone}>
          {loading ? 'Calling…' : 'Call from my Chatforia number'}
        </Button>
      </Stack>
    </form>
  );
}
