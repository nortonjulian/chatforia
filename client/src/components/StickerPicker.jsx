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

// ---- shared tab values (inline constants) ----
const TAB_EMOJI = 'emoji';
const TAB_GIFS = 'gifs';

// Turn a native emoji → Twemoji SVG URL
function emojiToTwemojiUrl(native) {
  const codepoints = Array.from(native)
    .map((c) => c.codePointAt(0)?.toString(16))
    .filter(Boolean)
    .filter((cp) => cp !== 'fe0f');
  const fn = codepoints.join('-');
  return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${fn}.svg`;
}

const TENOR_KEY = import.meta.env.VITE_TENOR_KEY || '';
const TENOR_CLIENT = 'chatforia-web';
const TENOR_LIMIT = 36;

export default function StickerPicker({ opened, onClose, onPick, initialTab = TAB_EMOJI }) {
  const [tab, setTab] = useState(initialTab);

  // keep tab in sync with caller (works when modal is already open too)
  useEffect(() => {
    const next = (initialTab === TAB_GIFS || initialTab === TAB_EMOJI) ? initialTab : TAB_EMOJI;
    if (next !== tab) setTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  // ---- GIF state ----
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [gifs, setGifs] = useState([]);
  const canUseTenor = Boolean(TENOR_KEY);

  async function fetchGifs(endpoint) {
    setLoading(true);
    try {
      const res = await fetch(endpoint);
      const json = await res.json();
      const items = (json.results || json.gifs || [])
        .map((it) => {
          const media = it.media_formats || it.media || {};
          const gif =
            media.gif || media.mediumgif || media.tinygif || media.nanogif || {};
          return {
            id: it.id,
            url: gif.url,
            width: Number(gif.dims?.[0] || gif.width || 480),
            height: Number(gif.dims?.[1] || gif.height || 270),
            durationSec: Number(gif.duration || 0),
          };
        })
        .filter((x) => x.url);
      setGifs(items);
    } catch (e) {
      console.error('Tenor fetch failed', e);
      setGifs([]);
    } finally {
      setLoading(false);
    }
  }

  // Initial trending when opened
  useEffect(() => {
    if (!opened || !canUseTenor) return;
    const url = new URL('https://tenor.googleapis.com/v2/featured');
    url.searchParams.set('key', TENOR_KEY);
    url.searchParams.set('client_key', TENOR_CLIENT);
    url.searchParams.set('limit', String(TENOR_LIMIT));
    url.searchParams.set('media_filter', 'gif');
    url.searchParams.set('contentfilter', 'high');
    fetchGifs(url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, canUseTenor]);

  // Debounced search / featured
  useEffect(() => {
    if (!canUseTenor) return;
    const id = setTimeout(() => {
      const endpoint = new URL(
        q.trim()
          ? 'https://tenor.googleapis.com/v2/search'
          : 'https://tenor.googleapis.com/v2/featured'
      );
      endpoint.searchParams.set('key', TENOR_KEY);
      endpoint.searchParams.set('client_key', TENOR_CLIENT);
      endpoint.searchParams.set('limit', String(TENOR_LIMIT));
      endpoint.searchParams.set('media_filter', 'gif');
      endpoint.searchParams.set('contentfilter', 'high');
      if (q.trim()) endpoint.searchParams.set('q', q.trim());
      fetchGifs(endpoint.toString());
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, canUseTenor]);

  // Reset search whenever the modal opens
  useEffect(() => {
    if (opened) setQ('');
  }, [opened]);

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

        {/* Emoji */}
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
                Tip: Tap any emoji to add it as a sticker (sent as an image via Twemoji).
              </Text>
            </Box>
          </ScrollArea>
        </Tabs.Panel>

        {/* GIFs */}
        <Tabs.Panel value={TAB_GIFS} pt="sm">
          {!canUseTenor ? (
            <Box p="md">
              <Text fw={600} mb={6}>GIFs unavailable</Text>
              <Text size="sm" c="dimmed">
                Add a Tenor API key to your <code>.env</code>:
              </Text>
              <Box component="pre" mt="xs" p="xs" style={{ background: 'var(--mantine-color-gray-1)', borderRadius: 8, overflow: 'auto' }}>
                VITE_TENOR_KEY=YOUR_TENOR_API_KEY
              </Box>
            </Box>
          ) : (
            <>
              <TextInput
                placeholder="Search GIFs (Tenor)…"
                value={q}
                onChange={(e) => setQ(e.currentTarget.value)}
                mb="xs"
              />
              <ScrollArea style={{ height: '58vh' }} type="auto">
                {loading ? (
                  <Group justify="center" py="xl"><Loader /></Group>
                ) : gifs.length === 0 ? (
                  <Group justify="center" py="xl"><Text c="dimmed">No results.</Text></Group>
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
                            width: g.width,
                            height: g.height,
                            durationSec: g.durationSec || null,
                            _source: 'tenor',
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
                        <Image src={g.url} alt="gif" fit="cover" height={120} fallbackSrc="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </>
          )}
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
