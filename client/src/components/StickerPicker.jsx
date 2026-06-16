import { useEffect, useState } from 'react';
import {
  Modal,
  Tabs,
  TextInput,
  ScrollArea,
  Group,
  Image,
  Loader,
  Box,
  Text,
} from '@mantine/core';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import axiosClient from '../api/axiosClient';

const TAB_EMOJI = 'emoji';
const TAB_GIFS = 'gifs';

function emojiToTwemojiUrl(native) {
  const codepoints = Array.from(native)
    .map((c) => c.codePointAt(0)?.toString(16))
    .filter(Boolean)
    .filter((cp) => cp !== 'fe0f');

  const fn = codepoints.join('-');
  return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${fn}.svg`;
}

export default function StickerPicker({
  opened,
  onClose,
  onPick,
  initialTab = TAB_EMOJI,
}) {
  const [tab, setTab] = useState(initialTab);

  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [gifs, setGifs] = useState([]);
  const [gifError, setGifError] = useState('');

  useEffect(() => {
    const next =
      initialTab === TAB_GIFS || initialTab === TAB_EMOJI
        ? initialTab
        : TAB_EMOJI;

    if (next !== tab) {
      setTab(next);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  async function fetchGifs(searchText = '') {
    setLoading(true);
    setGifError('');

    try {
      const res = await axiosClient.get('/stickers/search', {
        params: searchText.trim() ? { q: searchText.trim() } : {},
      });

      const items = (res.data?.results || [])
        .map((it) => ({
          id: it.id,
          url: it.url,
          previewUrl: it.thumb || it.url,
          width: Number(it.width || 480),
          height: Number(it.height || 270),
          durationSec: Number(it.durationSec || 0),
          provider: it.provider || 'giphy',
          providerId: it.providerId || it.id,
        }))
        .filter((x) => x.url);

      setGifs(items);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('GIF fetch failed', e);
      setGifError('GIFs are unavailable right now.');
      setGifs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!opened) return;

    setQ('');
    fetchGifs('');

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  useEffect(() => {
    if (!opened || tab !== TAB_GIFS) return;

    const id = setTimeout(() => {
      fetchGifs(q);
    }, 300);

    return () => clearTimeout(id);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, opened, tab]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Stickers & GIFs"
      centered
      size="lg"
      overlayProps={{ blur: 2 }}
      styles={{ content: { overflow: 'hidden' }, body: { paddingTop: 0 } }}
    >
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List grow>
          <Tabs.Tab value={TAB_EMOJI}>Emoji</Tabs.Tab>
          <Tabs.Tab value={TAB_GIFS}>GIFs</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value={TAB_EMOJI} pt="sm">
          <ScrollArea style={{ height: '62vh' }} type="auto">
            <Box p="xs">
              <Picker
                data={data}
                emojiSize={24}
                perLine={9}
                navPosition="bottom"
                previewPosition="none"
                onEmojiSelect={(e) => {
                  const url = emojiToTwemojiUrl(e.native);

                  onPick?.({
                    kind: 'EMOJI',
                    native: e.native,
                    url,
                    width: 128,
                    height: 128,
                    _source: 'emoji',
                  });
                }}
              />

              <Text size="xs" c="dimmed" mt="xs">
                Tip: Tap any emoji to add it as a sticker.
              </Text>
            </Box>
          </ScrollArea>
        </Tabs.Panel>

        <Tabs.Panel value={TAB_GIFS} pt="sm">
          <TextInput
            placeholder="Search GIFs…"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            mb="xs"
          />

          <ScrollArea style={{ height: '58vh' }} type="auto">
            {loading ? (
              <Group justify="center" py="xl">
                <Loader />
              </Group>
            ) : gifError ? (
              <Group justify="center" py="xl">
                <Text c="dimmed">{gifError}</Text>
              </Group>
            ) : gifs.length === 0 ? (
              <Group justify="center" py="xl">
                <Text c="dimmed">No results.</Text>
              </Group>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                  padding: 8,
                }}
              >
                {gifs.map((g) => (
                  <button
                    key={g.id}
                    onClick={() =>
                      onPick?.({
                        kind: 'GIF',
                        url: g.url,
                        mimeType: 'image/gif',
                        width: g.width,
                        height: g.height,
                        durationSec: g.durationSec || null,
                        provider: g.provider || 'giphy',
                        providerId: g.providerId || g.id,
                        _source: 'giphy',
                      })
                    }
                    style={{
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      background: 'transparent',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}
                    title="Add GIF"
                  >
                    <Image
                      src={g.previewUrl || g.url}
                      alt="gif"
                      fit="cover"
                      height={120}
                      fallbackSrc=""
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          <Text size="xs" c="dimmed" mt="xs" ta="center">
            Powered by GIPHY
          </Text>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}