import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Stack,
  Text,
  TextInput,
  Group,
  Button,
  Card,
  ThemeIcon,
  Divider,
  ScrollArea,
} from '@mantine/core';
import {
  Search,
  MessageSquarePlus,
  Phone,
} from 'lucide-react';

function buildContactSubtitle(contact) {
  const parts = [];

  if (contact.interactionType) {
    const labelMap = {
      message: 'Message',
      call: 'Call',
      video: 'Video',
    };
    parts.push(labelMap[contact.interactionType] || '');
  }

  if (contact.phone) parts.push(contact.phone);
  if (contact.username) parts.push(`@${contact.username}`);

  return parts.filter(Boolean).join(' • ');
}

function ContactRow({ contact, onSelect }) {
  const subtitle = buildContactSubtitle(contact);

  return (
    <Card
      withBorder
      radius="lg"
      p="sm"
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(contact)}
    >
      <Group justify="space-between" align="center">
        <div style={{ flex: 1 }}>
          <Text fw={600}>
            {contact.name ||
              contact.displayName ||
              contact.username ||
              contact.phone ||
              'Unknown'}
          </Text>

          {subtitle && (
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          )}
        </div>

        <ThemeIcon radius="xl" variant="light" color="yellow">
          <Phone size={16} />
        </ThemeIcon>
      </Group>
    </Card>
  );
}

export default function StartChatModal({
  opened,
  onClose,
  initialDraft,
  onStartDirectMessage,
  recentInteractions = [],
  savedContacts = [],
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (opened) {
      setQuery(initialDraft?.value || '');
    }
  }, [opened, initialDraft]);

  const normalizedRecent = useMemo(() => {
    return Array.isArray(recentInteractions)
      ? recentInteractions.slice(0, 8)
      : [];
  }, [recentInteractions]);

  const normalizedSaved = useMemo(() => {
    return Array.isArray(savedContacts) ? savedContacts : [];
  }, [savedContacts]);

  const visibleContacts = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return normalizedRecent;

    return normalizedSaved.filter((contact) => {
      const haystack = [
        contact.name,
        contact.displayName,
        contact.alias,
        contact.username,
        contact.phone,
        contact.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [query, normalizedRecent, normalizedSaved]);

  const sectionLabel = query.trim()
    ? 'Contacts'
    : 'Recent interactions';

  const handleDirectStart = () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    onStartDirectMessage?.({
      type: 'manual',
      value: trimmed,
    });
  };

  const handleSelectContact = (contact) => {
    onStartDirectMessage?.({
      type: 'contact',
      value: contact,
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Start a conversation"
      centered
      radius="xl"
      size="lg"
      overlayProps={{ blur: 3 }}
    >
      <Stack gap="md">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search name, username, or phone number"
          leftSection={<Search size={16} />}
          radius="xl"
          size="md"
        />

        <Group grow>
          <Button
            radius="xl"
            color="yellow"
            leftSection={<MessageSquarePlus size={16} />}
            onClick={handleDirectStart}
            disabled={!query.trim()}
          >
            Message this person
          </Button>
        </Group>

        <Divider label={sectionLabel} labelPosition="center" />

        <ScrollArea.Autosize mah={260}>
          <Stack gap="sm">
            {visibleContacts.length ? (
              visibleContacts.map((contact) => (
                <ContactRow
                  key={
                    contact.id ||
                    contact.userId ||
                    contact.phone ||
                    contact.username
                  }
                  contact={contact}
                  onSelect={handleSelectContact}
                />
              ))
            ) : (
              <Text size="sm" c="dimmed" ta="center" py="md">
                {query.trim()
                  ? 'No contacts match your search.'
                  : 'No recent interactions yet.'}
              </Text>
            )}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
}