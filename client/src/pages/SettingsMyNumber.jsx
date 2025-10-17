import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PremiumGuard from '@/components/PremiumGuard';

export default function SettingsMyNumber() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { (async () => {
    const res = await fetch('/numbers/my');
    const json = await res.json();
    setData(json); setLoading(false);
  })(); }, []);

  if (loading) return <div className="p-4">Loading…</div>;
  const { number, policy } = data || {};

  return (
    <div className="p-4 max-w-2xl">
      <h2 className="text-xl font-semibold mb-2">My Number</h2>
      {!number ? (
        <div className="rounded-lg border p-4">
          <p className="mb-2">You don’t have a Chatforia number yet.</p>
          <NumberPickerButton />
        </div>
      ) : (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold">{number.e164}</div>
              <div className="text-sm text-gray-500">Status: {number.status}</div>
            </div>
            <button className="px-3 py-2 rounded-lg border" onClick={() => navigate('/settings/number/change')}>Change Number</button>
          </div>

          {number.keepLocked ? (
            <div className="text-green-700 bg-green-50 p-2 rounded">Keep-My-Number is active — your number will not be recycled.</div>
          ) : (
            <div className="text-amber-700 bg-amber-50 p-2 rounded">
              Inactivity policy: {policy.inactivityDays} days → hold for {policy.holdDays} days, then release. Keep your number by enabling Keep-My-Number.
            </div>
          )}

          <div className="flex gap-2">
            <PremiumGuard inline>
              {!number.keepLocked ? (
                <button className="px-3 py-2 rounded-lg bg-black text-white"
                  onClick={async () => { await fetch('/numbers/keep/enable', { method: 'POST' }); window.location.reload(); }}>
                  Enable Keep-My-Number
                </button>
              ) : (
                <button className="px-3 py-2 rounded-lg border"
                  onClick={async () => { await fetch('/numbers/keep/disable', { method: 'POST' }); window.location.reload(); }}>
                  Disable Keep-My-Number
                </button>
              )}
            </PremiumGuard>

            <button className="px-3 py-2 rounded-lg border" onClick={async () => { await fetch('/numbers/release', { method: 'POST' }); window.location.reload(); }}>
              Release Number
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberPickerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={() => setOpen(true)}>Get a Number</button>
      {open && <NumberPickerModal onClose={() => setOpen(false)} />}
    </>
  );
}

function NumberPickerModal({ onClose }) {
  const [areaCode, setAreaCode] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    setLoading(true);
    const res = await fetch(`/numbers/available?areaCode=${areaCode}`);
    const json = await res.json();
    setList(json.numbers || []);
    setLoading(false);
  }

  async function reserveThenClaim(e164) {
    const r = await fetch('/numbers/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ e164 }),
    });
    if (!r.ok) { alert('Failed to reserve'); return; }
    // TODO: integrate Stripe checkout if charging here; otherwise claim directly
    const c = await fetch('/numbers/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ e164 }),
    });
    if (!c.ok) { alert('Failed to claim'); return; }
    window.location.reload();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-xl p-4 w-full max-w-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Choose a Number</h3>
          <button className="text-gray-500" onClick={onClose}>✕</button>
        </div>

        <div className="flex gap-2">
          <input
            value={areaCode}
            onChange={e=>setAreaCode(e.target.value)}
            placeholder="Area code (e.g., 303)"
            className="border rounded px-2 py-1 flex-1"
          />
          {/* Provider is fixed server-side: Twilio */}
          <span className="text-xs text-gray-500 self-center">Provider: Twilio</span>
          <button className="px-3 py-1 rounded bg-black text-white" onClick={search} disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        <div className="max-h-64 overflow-auto divide-y border rounded">
          {list.map(n => (
            <div key={n.e164 || n} className="p-2 flex items-center justify-between">
              <div>
                <div className="font-medium">{n.e164 || n}</div>
                {n.areaCode && <div className="text-xs text-gray-500">AC {n.areaCode}</div>}
              </div>
              <button className="px-3 py-1 rounded border" onClick={() => reserveThenClaim(n.e164 || n)}>Select</button>
            </div>
          ))}
          {list.length === 0 && <div className="p-4 text-sm text-gray-500">No results yet.</div>}
        </div>
      </div>
    </div>
  );
}
