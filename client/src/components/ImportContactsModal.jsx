import { useEffect, useMemo, useState } from 'react';
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
    const cards = parseVCard(text);
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

export default function ImportContactsModal({ opened, onClose, defaultCountry = 'US' }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opened) {
      setRows([]);
      setSelected(new Set());
      setFilter('');
    }
  }, [opened]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (r) =>
        (r.name || '').toLowerCase().includes(f) ||
        (r.phones || []).some((p) => p.includes(f)) ||
        (r.emails || []).some((e) => e.toLowerCase().includes(f))
    );
  }, [rows, filter]);

  const toggle = (idx) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelected(next);
  };

  const pickFromDevice = async () => {
    try {
      const props = ['name', 'tel', 'email'];
      const opts = { multiple: true };
      const picked = await navigator.contacts.select(props, opts);
      const mapped = picked.map((p) => ({
        name: Array.isArray(p.name) ? p.name[0] : p.name,
        phones: (p.tel || []).map(String),
        emails: (p.email || []).map(String),
      }));
      setRows(mapped);
      setSelected(new Set(mapped.map((_, i) => i)));
      toast.ok(`Imported ${mapped.length} from device (preview)`);
    } catch {
      toast.err('Unable to read contacts from device.');
    }
  };

  const onCSV = (file) => {
    if (!file) return;
    Papa.parse(file, {
      complete: (res) => {
        const mapped = mapCSV(res.data);
        setRows(mapped);
        setSelected(new Set(mapped.map((_, i) => i)));
        toast.ok(`Parsed ${mapped.length} contacts from CSV.`);
      },
      error: () => toast.err('Failed parsing CSV.'),
      skipEmptyLines: true,
    });
  };

  const onVCF = async (file) => {
    if (!file) return;
    const text = await file.text();
    const mapped = mapVCF(text);
    setRows(mapped);
    setSelected(new Set(mapped.map((_, i) => i)));
    toast.ok(`Parsed ${mapped.length} contacts from VCF.`);
  };

  const submit = async () => {
    const payload = filtered
      .map((c, i) => ({ c, i }))
      .filter(({ i }) => selected.has(i))
      .map(({ c }) => c);

    if (!payload.length) {
      toast.info('Select at least one contact.');
      return;
    }
    if (payload.length > 2000) {
      toast.err('Limit 2000 contacts per import.');
      return;
    }

    setLoading(true);
    try {
      const res = await importContacts({ defaultCountry, contacts: payload });
      toast.ok(
        `Imported: ${res.added} • Updated: ${res.updated} • Duplicates: ${res.skippedDuplicates} • Invalid: ${res.invalid}`
      );
      onClose?.();
    } catch {
      toast.err('Import failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!opened) return null;

  return (
    <section role="dialog" aria-label="Import contacts" style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
      <h2>Import contacts</h2>

      <p style={{ opacity: 0.75 }}>
        Only the contacts you select will be uploaded. Phone numbers are normalized to your region ({defaultCountry}).
      </p>

      {canUseContactsPicker() && (
        <div style={{ marginBottom: 8 }}>
          <button type="button" onClick={pickFromDevice}>Open phone contacts</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label style={{ display: 'block' }}>
          CSV:&nbsp;
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onCSV(e.target.files?.[0] || null)}
          />
        </label>
        <label style={{ display: 'block' }}>
          VCF:&nbsp;
          <input
            type="file"
            accept=".vcf,text/vcard"
            onChange={(e) => onVCF(e.target.files?.[0] || null)}
          />
        </label>
        <input
          type="text"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      <hr />

      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ width: 48 }} />
              <th style={{ textAlign: 'left', padding: '6px' }}>Name</th>
              <th style={{ textAlign: 'left', padding: '6px' }}>Phones</th>
              <th style={{ textAlign: 'left', padding: '6px' }}>Emails</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((c, i) => (
              <tr key={i} style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <td style={{ padding: '6px' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                    aria-label={`Select row ${i}`}
                  />
                </td>
                <td style={{ padding: '6px' }}>{c.name || <span style={{ opacity: 0.6 }}>—</span>}</td>
                <td style={{ padding: '6px' }}>{(c.phones || []).join(', ') || <span style={{ opacity: 0.6 }}>—</span>}</td>
                <td style={{ padding: '6px' }}>{(c.emails || []).join(', ') || <span style={{ opacity: 0.6 }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <p style={{ opacity: 0.75, marginTop: 6 }}>Showing first 500… refine filter to narrow.</p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" onClick={submit} aria-busy={loading ? 'true' : 'false'}>
          Import selected
        </button>
      </div>
    </section>
  );
}