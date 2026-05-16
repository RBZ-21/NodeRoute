import { useEffect, useState } from 'react';
import { Users, Download } from 'lucide-react';

interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  source: string;
  created_at: string;
}

export function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/waitlist', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error)))
      .then(data => { setEntries(data); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, []);

  function exportCSV() {
    const header = 'Name,Email,Company,Source,Signed Up';
    const rows = entries.map(e =>
      [
        e.name    ?? '',
        e.email,
        e.company ?? '',
        e.source,
        new Date(e.created_at).toLocaleString(),
      ]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv  = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-teal-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Waitlist</h1>
            <p className="text-sm text-white/50">{loading ? '…' : `${entries.length} signup${entries.length !== 1 ? 's' : ''}`}</p>
          </div>
        </div>
        {entries.length > 0 && (
          <button
            onClick={exportCSV}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 hover:bg-white/10 transition-colors"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        )}
      </div>

      {loading && (
        <div className="text-white/40 text-sm">Loading…</div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="text-white/40 text-sm">No signups yet.</div>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-white/50">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Signed Up</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr
                  key={e.id}
                  className={`border-b border-white/5 text-white/80 hover:bg-white/5 transition-colors ${
                    i % 2 === 0 ? '' : 'bg-white/[0.02]'
                  }`}
                >
                  <td className="px-4 py-3">{e.name ?? <span className="text-white/30">—</span>}</td>
                  <td className="px-4 py-3">
                    <a href={`mailto:${e.email}`} className="text-teal-400 hover:underline">{e.email}</a>
                  </td>
                  <td className="px-4 py-3">{e.company ?? <span className="text-white/30">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">{e.source}</span>
                  </td>
                  <td className="px-4 py-3 text-white/50 text-xs">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
