import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, FileInput, Group, Modal, ScrollArea, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import Papa from 'papaparse';
import { parse as parseVCard } from 'vcard-parser';
import { importContacts } from '@/api/contacts';
import { toast } from '@/utils/toast';

function mapCSV(rows) {
  const lower = (s) => (s || '').toLowerCase();
  const findCol = (cols, keys) => {
    const i = cols.findIndex((c) => keys.some((k) => lower(c).includes(k)));
    return i >= 0 ? i : null;
  };

  const [header, ...data] = rows;
  if (!header) return [];

  const nameIdx = findCol(header, ['name', 'full name', 'display']);
  const phoneIdx = findCol(header, ['phone', 'mobile', 'tel']);
  const emailIdx = findCol(header, ['email', 'mail']);

  return data
    .map((r) => ({
      name: nameIdx != null ? r[nameIdx] : '',
      phones:
        phoneIdx != null
          ? String(r[phoneIdx] || '')
              .split(/[;,/]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      emails:
        emailIdx != null
          ? String(r[emailIdx] || '')
              .split(/[;,/]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
    }))
    .filter((c) => c.name || c.phones?.length || c.emails?.length);
}

function mapVCF(text) {
  try {
    // vcard-parser returns one object per card, not an array for the file.
    const blocks = String(text || '').match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || [];
    const cards = blocks.map(block => parseVCard(block));
    return cards
      .map((card) => {
        const name = (card.fn && card.fn[0]?.value) || '';
        const tels = (card.tel || [])
          .map((t) => (Array.isArray(t.value) ? t.value[0] : t.value))
          .filter(Boolean);
        const emails = (card.email || [])
          .map((e) => (Array.isArray(e.value) ? e.value[0] : e.value))
          .filter(Boolean);
        return { name, phones: tels, emails };
      })
      .filter((c) => c.name || c.phones?.length || c.emails?.length);
  } catch {
    return [];
  }
}

function canUseContactsPicker() {
  return (
    typeof navigator !== 'undefined' &&
    navigator.contacts &&
    typeof navigator.contacts.select === 'function'
  );
}

export default function ImportContactsModal({ opened, onClose, onImported, defaultCountry = 'US' }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [csvFile, setCSVFile] = useState(null);
  const [vcfFile, setVCFFile] = useState(null);
  const generation = useRef(0);
  const submitting = useRef(false);

  useEffect(() => {
    generation.current += 1;
    setRows([]);
    setSelected(new Set());
    setFilter('');
    setError('');
    setParsing(false);
    setCSVFile(null);
    setVCFFile(null);
    return () => { generation.current += 1; };
  }, [opened]);

  // Retain the original row identity when searching or hiding rows.
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return rows.map((contact, index) => ({ contact, index })).filter(({ contact }) =>
      !f || (contact.name || '').toLowerCase().includes(f) ||
      (contact.phones || []).some(phone => phone.toLowerCase().includes(f)) ||
      (contact.emails || []).some(email => email.toLowerCase().includes(f))
    );
  }, [rows, filter]);
  const selectedContacts = rows.filter((_, index) => selected.has(index));
  const busy = loading || parsing;
  const allVisibleSelected = filtered.length > 0 && filtered.every(({ index }) => selected.has(index));
  const someVisibleSelected = filtered.some(({ index }) => selected.has(index));

  const close = () => {
    if (submitting.current) return;
    generation.current += 1;
    onClose?.();
  };
  const toggle = index => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });
  const toggleVisible = () => setSelected(previous => {
    const next = new Set(previous);
    filtered.forEach(({ index }) => {
      if (allVisibleSelected) next.delete(index); else next.add(index);
    });
    return next;
  });
  const acceptPreview = (mapped, request) => {
    if (request !== generation.current) return;
    setParsing(false);
    setRows(mapped);
    setSelected(new Set(mapped.map((_, index) => index)));
    setFilter('');
    setError(mapped.length ? '' : 'No contacts found. Choose a CSV with name, phone or email columns, or a VCF contact file.');
  };
  const failPreview = (request, message) => {
    if (request !== generation.current) return;
    setParsing(false);
    setError(message);
  };
  const beginPreview = () => {
    const request = ++generation.current;
    setRows([]); setSelected(new Set()); setError(''); setParsing(true);
    return request;
  };
  const pickFromDevice = async () => {
    const request = beginPreview();
    try {
      const picked = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true });
      acceptPreview(picked.map(contact => ({
        name: String((Array.isArray(contact.name) ? contact.name[0] : contact.name) || ''),
        phones: (contact.tel || []).map(String),
        emails: (contact.email || []).map(String),
      })), request);
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (request === generation.current) setParsing(false);
      } else failPreview(request, 'Unable to read device contacts. You can choose a CSV or VCF file instead.');
    }
  };
  const onCSV = file => {
    if (!file) return;
    setCSVFile(file); setVCFFile(null);
    const request = beginPreview();
    Papa.parse(file, {
      complete: result => {
        if (result.errors?.length) {
          failPreview(request, 'Could not read this CSV. Check the file format and try again.');
          return;
        }
        acceptPreview(mapCSV(result.data), request);
      },
      error: () => failPreview(request, 'Could not read this CSV. Please try again.'),
      skipEmptyLines: true,
    });
  };
  const onVCF = async file => {
    if (!file) return;
    setVCFFile(file); setCSVFile(null);
    const request = beginPreview();
    try { acceptPreview(mapVCF(await file.text()), request); }
    catch { failPreview(request, 'Could not read this VCF. Please try again.'); }
  };
  const submit = async () => {
    if (busy || submitting.current || !selectedContacts.length) return;
    if (selectedContacts.length > 2000) {
      setError('Select no more than 2,000 contacts per import.');
      return;
    }
    const request = generation.current;
    submitting.current = true; setLoading(true); setError('');
    try {
      const result = await importContacts({ defaultCountry, contacts: selectedContacts });
      if (request !== generation.current) return;
      toast.ok(`Saved ${result.importedCount} phone contact${result.importedCount === 1 ? '' : 's'}.`);
      onImported?.(result);
      onClose?.();
    } catch (error) {
      if (request === generation.current) setError(error?.response?.data?.error || error?.message || 'Import failed. Your selection is preserved. Please try again.');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <Modal opened={opened} onClose={close} title="Import contacts" size="lg" centered
      closeOnClickOutside={!loading} closeOnEscape={!loading} withCloseButton={!loading}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Preview a CSV or VCF file, then choose which contacts to import. Only selected contacts
          will be uploaded. Each phone number is saved as a phone contact. Email addresses are not imported; contacts without a phone number are skipped.
        </Text>
        {canUseContactsPicker() && (
          <Button variant="light" onClick={pickFromDevice} disabled={busy}>Choose device contacts</Button>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <FileInput label="CSV file" placeholder="Choose a CSV file" accept=".csv,text/csv"
            value={csvFile} onChange={onCSV} disabled={busy} />
          <FileInput label="VCF file" placeholder="Choose a VCF file" accept=".vcf,text/vcard"
            value={vcfFile} onChange={onVCF} disabled={busy} />
        </SimpleGrid>
        {error && <Alert role="alert" color="red">{error}</Alert>}
        {parsing && <Text role="status" size="sm">Reading contacts…</Text>}
        {!rows.length && !parsing ? (
          <Box p="lg" style={{ border: '1px dashed var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-md)' }}>
            <Text fw={600} ta="center">Choose a file to preview your contacts</Text>
            <Text size="sm" c="dimmed" ta="center" mt="xs">
              CSV files should include name, phone or email columns. VCF files are contact exports
              from your address book. Nothing is uploaded until you click Import selected.
            </Text>
          </Box>
        ) : rows.length > 0 ? (
          <>
            <TextInput label="Search preview" placeholder="Search by name, phone or email"
              value={filter} onChange={event => setFilter(event.currentTarget.value)} disabled={busy} />
            <Group justify="space-between">
              <Text size="sm" aria-live="polite">{selectedContacts.length} of {rows.length} contacts selected</Text>
              {filter && <Text size="xs" c="dimmed">Selection includes contacts hidden by search.</Text>}
            </Group>
            <ScrollArea.Autosize mah={320} type="auto">
              <Table striped highlightOnHover style={{ minWidth: 420 }}>
                <Table.Thead><Table.Tr>
                  <Table.Th w={44}><Checkbox aria-label="Select all matching contacts" checked={allVisibleSelected}
                    indeterminate={!allVisibleSelected && someVisibleSelected} onChange={toggleVisible} disabled={busy} /></Table.Th>
                  <Table.Th>Name</Table.Th><Table.Th>Phones</Table.Th><Table.Th>Emails</Table.Th>
                </Table.Tr></Table.Thead>
                <Table.Tbody>
                  {filtered.slice(0, 500).map(({ contact, index }) => (
                    <Table.Tr key={index}>
                      <Table.Td><Checkbox aria-label={`Select ${contact.name || contact.phones[0] || contact.emails[0] || 'contact'} (row ${index + 1})`}
                        checked={selected.has(index)} onChange={() => toggle(index)} disabled={busy} /></Table.Td>
                      <Table.Td>{contact.name || '—'}</Table.Td>
                      <Table.Td>{contact.phones.join(', ') || '—'}</Table.Td>
                      <Table.Td>{contact.emails.join(', ') || '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {!filtered.length && <Text size="sm" c="dimmed" p="md">No matching contacts.</Text>}
            </ScrollArea.Autosize>
            {filtered.length > 500 && <Text size="xs" c="dimmed">Showing the first 500 matches. Search to find others; the selected count includes all rows.</Text>}
          </>
        ) : null}
        <Group justify="flex-end" wrap="wrap">
          <Button variant="default" onClick={close} disabled={loading}>Cancel</Button>
          <Button onClick={submit} loading={loading}
            disabled={busy || !selectedContacts.length || selectedContacts.length > 2000}>
            Import selected{selectedContacts.length ? ` (${selectedContacts.length})` : ''}
          </Button>
        </Group>
        {selectedContacts.length > 2000 && <Text size="sm" c="red">Select no more than 2,000 contacts per import.</Text>}
      </Stack>
    </Modal>
  );
}
