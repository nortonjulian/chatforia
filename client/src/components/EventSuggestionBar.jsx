import { useMemo, useState } from 'react';
import { Group, Button, Modal, TextInput, Textarea } from '@mantine/core';
import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import axiosClient from '../api/axiosClient';

function fmtGoogle(dtISO) {
  // YYYYMMDDTHHmmssZ in UTC
  return DateTime.fromISO(dtISO).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
}

function fmtLocalRange(startISO, endISO, isAllDay) {
  const s = DateTime.fromISO(startISO);
  const e = DateTime.fromISO(endISO);
  if (isAllDay) return `${s.toLocaleString(DateTime.DATE_MED)} (all day)`;
  const sameDay = s.hasSame(e, 'day');
  if (sameDay) {
    return `${s.toLocaleString(DateTime.DATE_MED)} • ${s.toLocaleString(
      DateTime.TIME_SIMPLE
    )}–${e.toLocaleString(DateTime.TIME_SIMPLE)}`;
  }
  return `${s.toLocaleString(DateTime.DATETIME_MED)} → ${e.toLocaleString(DateTime.DATETIME_MED)}`;
}

export default function EventSuggestionBar({
  messages,
  currentUser,
  chatroom,
  forcedText,     // optional: parse this specific message text instead of scanning last 5
  onClearForced,  // optional: called after modal opens when forcedText was used
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');

  // Scan the last few messages (or a forced message) for a natural-language date/time
  const candidate = useMemo(() => {
    const pool = forcedText
      ? [forcedText]
      : (messages || [])
          .slice(-5)
          .reverse()
          .map(m => m.decryptedContent || m.translatedForMe || m.rawContent || '')
          .filter(Boolean);

    for (const text of pool) {
      const res = chrono.parse(text, new Date(), { forwardDate: true })?.[0];
      if (res?.start) {
        const start = res.start.date();
        const end =
          (res.end && res.end.date()) ||
          DateTime.fromJSDate(start).plus({ hours: 1 }).toJSDate();

        return {
          snippet: text.slice(0, 200),
          startISO: DateTime.fromJSDate(start).toUTC().toISO(),
          endISO: DateTime.fromJSDate(end).toUTC().toISO(),
          isAllDay: !res.start.isCertain('hour'),
        };
      }
    }
    return null;
  }, [messages, forcedText]);

  if (!candidate || !chatroom?.id) return null;

  const openComposer = () => {
    setTitle(`Chatforia: ${chatroom?.name || 'Event'}`);
    setLocation('');
    setDescription(`From chat: "${candidate.snippet}"`);
    setOpen(true);
    // If this was opened via a specific message, clear the force so future renders
    // go back to scanning the last 5 messages.
    onClearForced?.();
  };

  const googleHref = () => {
    const q = new URLSearchParams({
      action: 'TEMPLATE',
      text: title || 'Event',
      dates: `${fmtGoogle(candidate.startISO)}/${fmtGoogle(candidate.endISO)}`,
      details: description || '',
      location: location || '',
    }).toString();
    return `https://calendar.google.com/calendar/render?${q}`;
  };

  const outlookHref = () => {
    const q = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: title || 'Event',
      startdt: DateTime.fromISO(candidate.startISO).toUTC().toISO(),
      enddt: DateTime.fromISO(candidate.endISO).toUTC().toISO(),
      body: description || '',
      location: location || '',
    }).toString();
    return `https://outlook.live.com/calendar/0/deeplink/compose?${q}`;
  };

  async function postEventToast(extraLines = []) {
    const whenLine = fmtLocalRange(
      candidate.startISO,
      candidate.endISO,
      candidate.isAllDay
    );
    const lines = [
      `📅 ${title || 'Event'}`,
      location ? `📍 ${location}` : null,
      `🕒 ${whenLine}`,
      ...(description ? [description] : []),
      ...extraLines,
    ].filter(Boolean);

    const form = new FormData();
    form.append('chatRoomId', String(chatroom.id));
    form.append('expireSeconds', '0');
    form.append('content', lines.join('\n'));

    try {
      await axiosClient.post('/messages', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } catch (e) {
      // Non-blocking: allow calendar action to succeed regardless.
      console.warn('event toast post failed', e);
    }
  }

  async function clickGoogle() {
    const href = googleHref();
    window.open(href, '_blank', 'noopener,noreferrer');
    await postEventToast([`➕ Google: ${href}`]);
    setOpen(false);
  }

  async function clickOutlook() {
    const href = outlookHref();
    window.open(href, '_blank', 'noopener,noreferrer');
    await postEventToast([`➕ Outlook: ${href}`]);
    setOpen(false);
  }

  async function downloadIcs() {
    try {
      // Use GET with responseType 'blob' and server-expected params 'start'/'end'
      const params = new URLSearchParams({
        title,
        description,
        location,
        start: candidate.startISO,
        end: candidate.endISO,
      }).toString();

      const { data } = await axiosClient.get(`/calendar/ics?${params}`, {
        responseType: 'blob',
      });

      const blob = new Blob([data], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'event.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      await postEventToast(['⬇️ ICS file downloaded (add to your calendar).']);
    } catch (e) {
      console.warn('ICS generation failed', e);
    }
    setOpen(false);
  }

  async function emailInvite() {
    const to = (prompt('Send invite to (comma-separated emails):') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!to.length) return;

    try {
      await axiosClient.post('/calendar/email-invite', {
        to,
        title,
        description,
        location,
        startISO: candidate.startISO,
        endISO: candidate.endISO,
      });
      await postEventToast([`📧 Invites emailed to: ${to.join(', ')}`]);
    } catch (e) {
      console.warn('email invite failed', e);
    }
    setOpen(false);
  }

  return (
    <>
      <Group justify="center" mt="xs" gap="xs">
        <Button size="xs" variant="light" onClick={openComposer}>
          Add to calendar?
        </Button>
      </Group>

      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title="Create calendar event"
        centered
      >
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          mb="sm"
        />
        <TextInput
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.currentTarget.value)}
          mb="sm"
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          mb="md"
        />

        <Group justify="space-between">
          <Group gap="xs">
            <Button size="xs" onClick={clickGoogle}>
              Google
            </Button>
            <Button size="xs" onClick={clickOutlook}>
              Outlook
            </Button>
            <Button size="xs" variant="light" onClick={downloadIcs}>
              Download .ics
            </Button>
          </Group>
          <Button size="xs" variant="default" onClick={emailInvite}>
            Email invite
          </Button>
        </Group>
      </Modal>
    </>
  );
}
