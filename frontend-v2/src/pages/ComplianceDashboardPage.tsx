/**
 * ComplianceDashboardPage.tsx
 * Route: /dashboard-v2/compliance
 *
 * FSMA 204 Compliance Dashboard — surfaces KTE coverage, CTE completeness,
 * TLC gaps, and missing-data alerts. All data fetched from existing backend
 * endpoints; degrades gracefully to mock data when the API is unavailable.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2,
  RefreshCw, Download, Info,
} from 'lucide-react';
import { apiFetch } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ComplianceSummary {
  score: number;              // 0-100
  kte_covered: number;
  kte_total: number;
  tlc_covered: number;
  tlc_total: number;
  open_gaps: number;
  last_updated: string;
}

interface CteRow {
  event_type: 'harvest' | 'cooling' | 'packing' | 'shipping' | 'receiving';
  total: number;
  complete: number;
  pct: number;
}

interface GapRow {
  id: string;
  item: string;
  location: string;
  event_type: string;
  gap_type: string;
  days_open: number;
}

// ── Mock fallback data ────────────────────────────────────────────────────────
const MOCK_SUMMARY: ComplianceSummary = {
  score: 74,
  kte_covered: 38,
  kte_total: 52,
  tlc_covered: 210,
  tlc_total: 248,
  open_gaps: 14,
  last_updated: new Date().toISOString(),
};

const MOCK_CTES: CteRow[] = [
  { event_type: 'harvest',   total: 80, complete: 72, pct: 90 },
  { event_type: 'cooling',   total: 75, complete: 58, pct: 77 },
  { event_type: 'packing',   total: 80, complete: 61, pct: 76 },
  { event_type: 'shipping',  total: 110, complete: 98, pct: 89 },
  { event_type: 'receiving', total: 110, complete: 85, pct: 77 },
];

const MOCK_GAPS: GapRow[] = [
  { id: '1', item: 'Atlantic Salmon (10 lb)',   location: 'Cold Storage A', event_type: 'cooling',   gap_type: 'Missing temp log',     days_open: 3  },
  { id: '2', item: 'Gulf Shrimp (5 lb)',        location: 'Dock 2',         event_type: 'receiving', gap_type: 'No TLC assigned',      days_open: 1  },
  { id: '3', item: 'Yellowfin Tuna (20 lb)',   location: 'Cold Storage B', event_type: 'packing',   gap_type: 'Supplier KTE missing', days_open: 5  },
  { id: '4', item: 'Mahi-Mahi (8 lb)',          location: 'Dock 1',         event_type: 'harvest',   gap_type: 'Harvest date missing', days_open: 2  },
  { id: '5', item: 'Red Snapper (12 lb)',       location: 'Dock 3',         event_type: 'shipping',  gap_type: 'Receiver KTE missing', days_open: 7  },
  { id: '6', item: 'Grouper (15 lb)',           location: 'Cold Storage A', event_type: 'packing',   gap_type: 'No TLC assigned',      days_open: 4  },
  { id: '7', item: 'Flounder (6 lb)',           location: 'Dock 2',         event_type: 'cooling',   gap_type: 'Missing temp log',     days_open: 1  },
  { id: '8', item: 'Wahoo (18 lb)',             location: 'Cold Storage C', event_type: 'receiving', gap_type: 'No TLC assigned',      days_open: 6  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function scoreColor(score: number): string {
  if (score >= 90) return 'text-emerald-400';
  if (score >= 75) return 'text-yellow-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 90) return 'bg-emerald-400/10 border-emerald-400/30';
  if (score >= 75) return 'bg-yellow-400/10 border-yellow-400/30';
  return 'bg-red-400/10 border-red-400/30';
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'Compliant';
  if (score >= 75) return 'Needs Attention';
  return 'At Risk';
}

function pctBar(pct: number) {
  const color = pct >= 85 ? 'bg-emerald-400' : pct >= 70 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-white/10">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-mono w-10 text-right text-gray-300">{pct}%</span>
    </div>
  );
}

const CTE_LABELS: Record<CteRow['event_type'], string> = {
  harvest:   'Harvest / First Land',
  cooling:   'Initial Cooling',
  packing:   'Packing & Labeling',
  shipping:  'Shipping / Transfer',
  receiving: 'Receiving',
};

// ── Component ─────────────────────────────────────────────────────────────────
export function ComplianceDashboardPage() {
  const [summary, setSummary]   = useState<ComplianceSummary | null>(null);
  const [ctes, setCtes]         = useState<CteRow[]>([]);
  const [gaps, setGaps]         = useState<GapRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      // Try live endpoints; fall back to mock on error
      const [sumRes, cteRes, gapRes] = await Promise.allSettled([
        apiFetch('/api/compliance/summary'),
        apiFetch('/api/compliance/cte-completeness'),
        apiFetch('/api/compliance/gaps'),
      ]);
      setSummary(sumRes.status === 'fulfilled' ? sumRes.value : MOCK_SUMMARY);
      setCtes(cteRes.status === 'fulfilled'    ? cteRes.value : MOCK_CTES);
      setGaps(gapRes.status === 'fulfilled'    ? gapRes.value : MOCK_GAPS);
      if (sumRes.status === 'rejected') setError('Live data unavailable — showing sample data.');
    } catch {
      setSummary(MOCK_SUMMARY);
      setCtes(MOCK_CTES);
      setGaps(MOCK_GAPS);
      setError('Live data unavailable — showing sample data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleExport = () => {
    // Stub: wire to PDF/CSV export endpoint when available
    alert('Export coming soon — will generate a PDF/CSV compliance report.');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-enterprise-gradient flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400" />
      </div>
    );
  }

  const s = summary ?? MOCK_SUMMARY;
  const ScoreIcon = s.score >= 75 ? ShieldCheck : ShieldAlert;

  return (
    <div className="p-6 space-y-6 text-white">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">FSMA 204 Compliance Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Food Traceability Rule — Key Tracking & Critical Events
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/10 hover:bg-white/15 transition"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 transition"
          >
            <Download size={14} />
            Export Report
          </button>
        </div>
      </div>

      {/* ── Banner error ───────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-400/10 border border-yellow-400/30 text-yellow-300 text-sm">
          <Info size={15} /> {error}
        </div>
      )}

      {/* ── KPI row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Score card */}
        <div className={`rounded-xl border p-5 flex flex-col items-center gap-2 ${scoreBg(s.score)}`}>
          <ScoreIcon size={28} className={scoreColor(s.score)} />
          <span className={`text-4xl font-bold ${scoreColor(s.score)}`}>{s.score}</span>
          <span className="text-xs text-gray-400 uppercase tracking-wider">Compliance Score</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${scoreBg(s.score)} ${scoreColor(s.score)}`}>
            {scoreLabel(s.score)}
          </span>
        </div>

        {/* KTE */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-2">
          <span className="text-xs text-gray-400 uppercase tracking-wider">KTE Coverage</span>
          <span className="text-3xl font-bold">{s.kte_covered}<span className="text-gray-500 text-lg">/{s.kte_total}</span></span>
          {pctBar(Math.round((s.kte_covered / (s.kte_total || 1)) * 100))}
          <span className="text-xs text-gray-500">Key Trading Entities verified</span>
        </div>

        {/* TLC */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-2">
          <span className="text-xs text-gray-400 uppercase tracking-wider">TLC Coverage</span>
          <span className="text-3xl font-bold">{s.tlc_covered}<span className="text-gray-500 text-lg">/{s.tlc_total}</span></span>
          {pctBar(Math.round((s.tlc_covered / (s.tlc_total || 1)) * 100))}
          <span className="text-xs text-gray-500">Traceability Lot Codes assigned</span>
        </div>

        {/* Open Gaps */}
        <div className={`rounded-xl border p-5 flex flex-col items-center gap-2 ${
          s.open_gaps === 0
            ? 'bg-emerald-400/10 border-emerald-400/30'
            : 'bg-red-400/10 border-red-400/30'
        }`}>
          {s.open_gaps === 0
            ? <CheckCircle2 size={28} className="text-emerald-400" />
            : <AlertTriangle size={28} className="text-red-400" />}
          <span className={`text-4xl font-bold ${
            s.open_gaps === 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>{s.open_gaps}</span>
          <span className="text-xs text-gray-400 uppercase tracking-wider">Open Gaps</span>
          <span className="text-xs text-gray-500">Records missing required data</span>
        </div>
      </div>

      {/* ── CTE Completeness ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
          Critical Tracking Event (CTE) Completeness
        </h2>
        <div className="space-y-3">
          {(ctes.length ? ctes : MOCK_CTES).map((row) => (
            <div key={row.event_type} className="grid grid-cols-[180px_1fr_80px] items-center gap-4">
              <span className="text-sm text-gray-300 truncate">{CTE_LABELS[row.event_type]}</span>
              {pctBar(row.pct)}
              <span className="text-xs text-gray-500 text-right">{row.complete}/{row.total} records</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Missing Data Gaps ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
          Open Traceability Gaps
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-white/10">
                <th className="pb-2 pr-4 font-medium">Item</th>
                <th className="pb-2 pr-4 font-medium">Location</th>
                <th className="pb-2 pr-4 font-medium">CTE</th>
                <th className="pb-2 pr-4 font-medium">Gap Type</th>
                <th className="pb-2 font-medium text-right">Days Open</th>
              </tr>
            </thead>
            <tbody>
              {(gaps.length ? gaps : MOCK_GAPS).map((g) => (
                <tr key={g.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="py-2 pr-4 text-white">{g.item}</td>
                  <td className="py-2 pr-4 text-gray-400">{g.location}</td>
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 rounded text-xs bg-white/10 text-gray-300 capitalize">
                      {g.event_type}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-300">{g.gap_type}</td>
                  <td className="py-2 text-right">
                    <span className={`font-mono font-semibold ${
                      g.days_open >= 5 ? 'text-red-400' : g.days_open >= 3 ? 'text-yellow-400' : 'text-gray-300'
                    }`}>{g.days_open}d</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {gaps.length === 0 && summary && (
            <p className="text-center text-gray-500 py-6">No open gaps — all records complete ✓</p>
          )}
        </div>
      </div>

      {/* ── Footer timestamp ───────────────────────────────────────────── */}
      <p className="text-xs text-gray-600 text-right">
        Last updated: {new Date(s.last_updated).toLocaleString()}
      </p>
    </div>
  );
}
