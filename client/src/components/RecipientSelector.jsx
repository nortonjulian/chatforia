import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Box,
  CloseButton,
  Group,
  Input,
  Kbd,
  Loader,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
  rem,
} from '@mantine/core';
import { IconUserPlus, IconChevronsDown } from '@tabler/icons-react';

/**
 * Recipient object shape:
 * { id: string, display: string, type: 'contact'|'user'|'raw', phone?: string, email?: string, avatarUrl?: string }
 *
 * Props:
 * - value: Recipient[]
 * - onChange: (next: Recipient[]) => void
 * - fetchSuggestions: async (query: string) => Promise<RecipientLike[]>
 *   where RecipientLike minimally has { id, display, ... }
 * - onRequestBrowse: () => void     // open ContactList drawer/modal
 * - maxRecipients?: number
 * - placeholder?: string
 */
export default function RecipientSelector({
  value,
  onChange,
  fetchSuggestions,
  onRequestBrowse,
  maxRecipients,
  placeholder = 'Type a name, number, or email…',
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef(null);
  const listRef = useRef(null);
  const canAddMore = maxRecipients ? value.length < maxRecipients : true;

  // --- utilities ---
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  const isPhone = (s) => /^\+?[0-9().\-\s]{7,}$/.test(s);

  const normalizeRaw = (s) => {
    const trimmed = s.trim();
    if (!trimmed) return null;
    if (isEmail(trimmed)) {
      return { id: `raw:${trimmed}`, display: trimmed, type: 'raw', email: trimmed };
    }
    if (isPhone(trimmed)) {
      const digits = trimmed.replace(/[^\d+]/g, '');
      return { id: `raw:${digits}`, display: trimmed, type: 'raw', phone: digits };
    }
    // Allow arbitrary text as a last resort (can be resolved server-side)
    return { id: `raw:${trimmed}`, display: trimmed, type: 'raw' };
  };

  const addRecipient = (rec) => {
    if (!rec || !canAddMore) return;
    const exists = value.some((r) => r.id === rec.id);
    if (exists) return;
    onChange([...value, rec]);
    setQuery('');
    setActiveIndex(-1);
  };

  const removeRecipient = (id) => {
    onChange(value.filter((r) => r.id !== id));
    // Keep focus on input for quick editing
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // --- debounced fetching ---
  const debouncedQuery = useDebounce(query, 250);
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!debouncedQuery.trim()) {
        setSuggestions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetchSuggestions(debouncedQuery.trim());
        if (!cancelled) {
          // filter out already-selected items
          const filtered = (Array.isArray(res) ? res : []).filter(
            (s) => !value.some((r) => r.id === s.id)
          );
          setSuggestions(filtered);
          setActiveIndex(filtered.length ? 0 : -1);
        }
      } catch (e) {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, fetchSuggestions, value]);

  // open popover when typing / focused
  useEffect(() => {
    setOpened(Boolean(query.trim()) && (loading || suggestions.length > 0));
  }, [query, loading, suggestions.length]);

  // Keep the active item visible when navigating with keys
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // --- keyboard handling on input ---
  const onKeyDown = (e) => {
    if (e.key === 'Backspace' && !query && value.length) {
      e.preventDefault();
      removeRecipient(value[value.length - 1].id);
      return;
    }
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setActiveIndex((i) => clamp(i + 1, 0, suggestions.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setActiveIndex((i) => clamp(i - 1, 0, suggestions.length - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!canAddMore) return;
      if (opened && activeIndex >= 0 && suggestions[activeIndex]) {
        addRecipient(suggestions[activeIndex]);
        return;
      }
      // add raw if there is a query
      const raw = normalizeRaw(query);
      if (raw) addRecipient(raw);
      return;
    }
    if (e.key === 'Escape') {
      setOpened(false);
      return;
    }
  };

  const hint = useMemo(() => {
    if (!canAddMore) return `Max ${maxRecipients} recipients`;
    if (loading) return 'Searching…';
    return '';
  }, [canAddMore, loading, maxRecipients]);

  return (
    <Stack gap="xs">
      <Input.Label>To</Input.Label>

      <Box
        aria-label="Recipient selector"
        role="combobox"
        aria-expanded={opened}
        aria-haspopup="listbox"
        sx={(theme) => ({
          border: `1px solid ${theme.colors.gray[4]}`,
          borderRadius: rem(8),
          padding: rem(6),
        })}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Selected chips */}
        {value.length > 0 && (
          <Group gap="xs" wrap="wrap" mb="xs">
            {value.map((r) => (
              <ChipBadge key={r.id} label={r.display} onRemove={() => removeRecipient(r.id)} />
            ))}
          </Group>
        )}

        {/* Input with actions */}
        <Group align="center" gap="xs" wrap="nowrap">
          <Popover
            opened={opened}
            withArrow
            width={360}
            position="bottom-start"
            middlewares={{ flip: true, shift: true }}
          >
            <Popover.Target>
              <TextInput
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onFocus={() => {
                  if (query && (loading || suggestions.length)) setOpened(true);
                }}
                onBlur={() => setTimeout(() => setOpened(false), 120)}
                onKeyDown={onKeyDown}
                placeholder={!canAddMore ? `Max ${maxRecipients} reached` : placeholder}
                disabled={!canAddMore}
                variant="unstyled"
                styles={{
                  input: { padding: 0, minHeight: rem(24) },
                }}
                rightSection={
                  <Group gap={4}>
                    <Tooltip label="Browse contacts">
                      <ActionIcon
                        size="sm"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onRequestBrowse?.()}
                      >
                        <IconUserPlus size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip
                      label={
                        <Group gap={6}>
                          <Text size="xs">Tips:</Text>
                          <Kbd>Enter</Kbd>
                          <Text size="xs">add</Text>
                          <Kbd>↑/↓</Kbd>
                          <Text size="xs">navigate</Text>
                          <Kbd>⌫</Kbd>
                          <Text size="xs">remove last</Text>
                        </Group>
                      }
                    >
                      <ActionIcon size="sm" variant="subtle">
                        <IconChevronsDown size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                }
                rightSectionWidth={72}
              />
            </Popover.Target>

            <Popover.Dropdown p={0}>
              <SuggestionList
                ref={listRef}
                items={suggestions}
                loading={loading}
                activeIndex={activeIndex}
                onHover={(idx) => setActiveIndex(idx)}
                onSelect={(item) => addRecipient(item)}
                emptyHint={
                  query ? (
                    <Box p="sm">
                      <Text size="sm" c="dimmed">
                        No matches. Press <Kbd>Enter</Kbd> to add “{query}”.
                      </Text>
                    </Box>
                  ) : null
                }
              />
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Box>

      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Stack>
  );
}

// ----------------- subcomponents -----------------

function ChipBadge({ label, onRemove }) {
  return (
    <Box
      component="span"
      sx={(t) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: rem(6),
        background: t.colors.gray[1],
        border: `1px solid ${t.colors.gray[3]}`,
        borderRadius: rem(999),
        padding: `${rem(4)} ${rem(8)}`,
      })}
    >
      <Text size="sm">{label}</Text>
      <CloseButton size="xs" onClick={onRemove} aria-label={`Remove ${label}`} />
    </Box>
  );
}

const SuggestionList = React.forwardRef(function SuggestionList(
  { items, loading, activeIndex, onHover, onSelect, emptyHint },
  ref
) {
  if (loading) {
    return (
      <Box p="sm">
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm">Searching…</Text>
        </Group>
      </Box>
    );
  }

  if (!items?.length) {
    return emptyHint || null;
  }

  return (
    <ScrollArea.Autosize mah={280}>
      <Stack gap={0} ref={ref} role="listbox" aria-activedescendant={`opt-${activeIndex}`}>
        {items.map((it, idx) => (
          <Box
            key={it.id}
            data-idx={idx}
            id={`opt-${idx}`}
            role="option"
            aria-selected={idx === activeIndex}
            onMouseEnter={() => onHover(idx)}
            onMouseDown={(e) => e.preventDefault()} // prevent input blur before click
            onClick={() => onSelect(it)}
            px="sm"
            py={8}
            sx={(t) => ({
              cursor: 'pointer',
              background: idx === activeIndex ? t.colors.gray[1] : 'transparent',
              borderBottom: `1px solid ${t.colors.gray[2]}`,
              '&:last-of-type': { borderBottom: 'none' },
            })}
          >
            <Text size="sm" fw={500}>
              {it.display}
            </Text>
            <AuxLine rec={it} />
          </Box>
        ))}
      </Stack>
    </ScrollArea.Autosize>
  );
});

function AuxLine({ rec }) {
  const meta = rec.email || rec.phone ? ` · ${rec.email ?? rec.phone}` : '';
  const type = rec.type && rec.type !== 'raw' ? `(${rec.type})` : '';
  if (!meta && !type) return null;
  return (
    <Text size="xs" c="dimmed">
      {type} {meta}
    </Text>
  );
}

// ----------------- hooks & helpers -----------------

function useDebounce(value, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
