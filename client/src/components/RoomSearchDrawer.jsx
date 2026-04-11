import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Drawer,
  TextInput,
  Stack,
  ScrollArea,
  Text,
  Group,
  Badge,
  Divider,
  Box,
} from '@mantine/core';
import useIsPremium from '@/hooks/useIsPremium';
import AdSlot from '../ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchableText(m) {
  const visibleText =
    m.decryptedContent ||
    m.translatedForMe ||
    m.rawContent ||
    m.content ||
    m.body ||
    '';

  const attachmentCaption = Array.isArray(m.attachments)
    ? m.attachments.map((a) => a?.caption || '').join(' ')
    : '';

  return normalize(`${visibleText} ${attachmentCaption}`);
}

export default function RoomSearchDrawer({
  opened,
  onClose,
  roomId,
  onJump,
  messages = [],
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const isPremium = useIsPremium();

  useEffect(() => {
    setQ('');
    setResults([]);
  }, [opened, roomId]);

  useEffect(() => {
    const nq = normalize(q);

    if (!nq) {
      setResults([]);
      return;
    }

    const source = Array.isArray(messages) ? messages : [];
    const filtered = source.filter((m) => getSearchableText(m).includes(nq));

    setResults(filtered.slice(-200));
  }, [q, messages]);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={t('roomSearch.title', 'Search in room')}
      position="right"
      size="md"
      radius="lg"
      aria-label={t('roomSearch.ariaLabel', 'Search in room')}
    >
      <Stack gap="sm">
        <TextInput
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder={t('roomSearch.searchMessages', 'Search messages')}
          label={t('roomSearch.search', 'Search')}
          autoFocus
        />

        <ScrollArea h={500}>
          <Stack gap="xs">
            {results.map((m) => {
              const text =
                m.decryptedContent ||
                m.translatedForMe ||
                m.rawContent ||
                m.content ||
                m.body ||
                '';

              const handleClick = () => {
                onJump?.(m.id);
                onClose?.();
              };

              return (
                <Box
                  key={m.id}
                  onClick={handleClick}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    borderRadius: 10,
                  }}
                >
                  <Group align="start" wrap="nowrap">
                    <Badge variant="light" style={{ flexShrink: 0 }}>
                      {new Date(m.createdAt).toLocaleString()}
                    </Badge>

                    <Text size="sm" style={{ flex: 1, wordBreak: 'break-word' }}>
                      {text.slice(0, 240) || t('roomSearch.noText', '[No text]')}
                    </Text>
                  </Group>
                </Box>
              );
            })}

            {!results.length && q.trim() && (
              <Text c="dimmed">{t('roomSearch.noResults', 'No results')}</Text>
            )}
          </Stack>
        </ScrollArea>

        {!isPremium && (
          <>
            <Divider my="xs" />
            <AdSlot placement={PLACEMENTS.SEARCH_RESULTS_FOOTER} />
          </>
        )}
      </Stack>
    </Drawer>
  );
}