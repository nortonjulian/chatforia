import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Stack,
  Checkbox,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import api from '@/api/axiosClient';

function isE164(s) { return /^\+?[1-9]\d{7,14}$/.test(String(s || '').replace(/[^\d+]/g, '')); }
function normalizeE164(s) { return String(s || '').replace(/[^\d+]/g, ''); }
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '')); }
function changed(a, b) { return JSON.stringify(a) !== JSON.stringify(b); }

export default function ForwardingSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(''); // <-- for test-visible success message

  const [form, setForm] = useState({
    forwardingEnabledSms: false,
    forwardSmsToPhone: false,
    forwardPhoneNumber: '',
    forwardSmsToEmail: false,
    forwardEmail: '',
    forwardingEnabledCalls: false,
    forwardToPhoneE164: '',
    forwardQuietHoursStart: null, // 0–23 or null
    forwardQuietHoursEnd: null,   // 0–23 or null
  });
  const [initial, setInitial] = useState(form);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/settings/forwarding');
        if (!alive) return;
        setForm(data);
        setInitial(data);
      } catch {
        // best-effort
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const hasChanges = useMemo(() => changed(form, initial), [form, initial]);

  const save = async () => {
    setSaving(true);
    setBanner('');
    try {
      const payload = {
        ...form,
        forwardPhoneNumber: form.forwardPhoneNumber ? normalizeE164(form.forwardPhoneNumber) : '',
        forwardToPhoneE164: form.forwardToPhoneE164 ? normalizeE164(form.forwardToPhoneE164) : '',
      };
      const { data } = await api.patch('/settings/forwarding', payload);
      setInitial(data);
      setForm(data);
      setBanner('Forwarding settings saved'); // <-- visible in tests
      // still call Mantine notifications if present
      try { notifications.show?.({ message: 'Forwarding settings saved', withBorder: true }); } catch {}
    } catch {
      setBanner('Failed to save settings');
      try { notifications.show?.({ message: 'Failed to save settings', color: 'red', withBorder: true }); } catch {}
    } finally {
      setSaving(false);
    }
  };

  const errors = useMemo(() => {
    const out = {};
    if (form.forwardingEnabledSms) {
      if (form.forwardSmsToPhone && !isE164(form.forwardPhoneNumber)) {
        out.forwardPhoneNumber = 'Enter a valid E.164 phone (e.g. +15551234567).';
      }
      if (form.forwardSmsToEmail && !isEmail(form.forwardEmail)) {
        out.forwardEmail = 'Enter a valid email.';
      }
      if (!form.forwardSmsToPhone && !form.forwardSmsToEmail) {
        out.smsToggle = 'Choose at least one destination (phone or email).';
      }
    }
    if (form.forwardingEnabledCalls) {
      if (!isE164(form.forwardToPhoneE164)) {
        out.forwardToPhoneE164 = 'Enter a valid E.164 phone.';
      }
    }
    const hrs = [form.forwardQuietHoursStart, form.forwardQuietHoursEnd];
    for (const v of hrs) {
      if (v != null && (Number.isNaN(+v) || +v < 0 || +v > 23)) {
        out.quiet = 'Quiet hours must be between 0 and 23.';
        break;
      }
    }
    return out;
  }, [form]);

  if (loading) {
    return (
      <Card withBorder>
        <Text size="sm" c="dimmed">Loading forwarding settings…</Text>
      </Card>
    );
  }

  return (
    <Card withBorder data-testid="card">
      <Stack gap="md">
        <div>
          <Title order={4}>Call and/or Text Forwarding</Title>
          <Text size="sm" c="dimmed">
            Forward incoming calls and texts to your verified phone or email. Outgoing calls/texts can show your Chatforia number.
          </Text>
        </div>

        {banner ? <Text role="status">{banner}</Text> : null}

        <Divider label="Text Forwarding" />

        <Stack gap="xs">
          {/* IMPORTANT: capture checked BEFORE setForm to avoid pooled-event nulls */}
          <Checkbox
            checked={form.forwardingEnabledSms}
            onChange={(e) => {
              const checked = !!e.currentTarget?.checked;
              setForm((f) => ({ ...f, forwardingEnabledSms: checked }));
            }}
            label="Enable text forwarding"
          />
          {errors.smsToggle && form.forwardingEnabledSms ? (
            <Text size="xs" c="red">{errors.smsToggle}</Text>
          ) : null}
          <Group grow align="end">
            <Checkbox
              checked={form.forwardSmsToPhone}
              onChange={(e) => {
                const checked = !!e.currentTarget?.checked;
                setForm((f) => ({ ...f, forwardSmsToPhone: checked }));
              }}
              label="Forward texts to phone"
            />
            <TextInput
              label="Destination phone (E.164)"
              placeholder="+15551234567"
              value={form.forwardPhoneNumber}
              onChange={(e) => {
                const val = e.target?.value ?? '';
                setForm((f) => ({ ...f, forwardPhoneNumber: val }));
              }}
              error={errors.forwardPhoneNumber}
              disabled={!form.forwardSmsToPhone}
            />
          </Group>
          <Group grow align="end">
            <Checkbox
              checked={form.forwardSmsToEmail}
              onChange={(e) => {
                const checked = !!e.currentTarget?.checked;
                setForm((f) => ({ ...f, forwardSmsToEmail: checked }));
              }}
              label="Forward texts to email"
            />
            <TextInput
              label="Destination email"
              placeholder="me@example.com"
              value={form.forwardEmail}
              onChange={(e) => {
                const val = e.target?.value ?? '';
                setForm((f) => ({ ...f, forwardEmail: val }));
              }}
              error={errors.forwardEmail}
              disabled={!form.forwardSmsToEmail}
            />
          </Group>
        </Stack>

        <Divider label="Call Forwarding (alias bridging)" />

        <Stack gap="xs">
          <Checkbox
            checked={form.forwardingEnabledCalls}
            onChange={(e) => {
              const checked = !!e.currentTarget?.checked;
              setForm((f) => ({ ...f, forwardingEnabledCalls: checked }));
            }}
            label="Enable call forwarding"
          />
          <TextInput
            label="Destination (E.164) for calls"
            placeholder="+15551234567"
            value={form.forwardToPhoneE164}
            onChange={(e) => {
              const val = e.target?.value ?? '';
              setForm((f) => ({ ...f, forwardToPhoneE164: val }));
            }}
            error={errors.forwardToPhoneE164}
            disabled={!form.forwardingEnabledCalls}
          />
        </Stack>

        <Divider label="Quiet Hours (optional)" />

        <Group grow>
          <NumberInput
            label="Start hour (0–23)"
            min={0}
            max={23}
            value={form.forwardQuietHoursStart}
            onChange={(v) => setForm((f) => ({ ...f, forwardQuietHoursStart: v ?? null }))}
          />
          <NumberInput
            label="End hour (0–23)"
            min={0}
            max={23}
            value={form.forwardQuietHoursEnd}
            onChange={(v) => setForm((f) => ({ ...f, forwardQuietHoursEnd: v ?? null }))}
          />
        </Group>
        {errors.quiet ? <Text size="xs" c="red">{errors.quiet}</Text> : null}

        <Group justify="flex-end" mt="sm">
          <Button
            variant="default"
            disabled={!hasChanges || saving}
            onClick={() => { setForm(initial); setBanner(''); }}
          >
            Reset
          </Button>
          <Button
            loading={saving}
            disabled={!hasChanges || Object.keys(errors).length > 0}
            onClick={save}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
