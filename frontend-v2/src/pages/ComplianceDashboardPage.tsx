/**
 * ComplianceDashboardPage.tsx
 * Route: /dashboard-v2/compliance
 *
 * FSMA 204 Compliance Dashboard — surfaces KTE coverage, CTE completeness,
 * TLC gaps, and missing-data alerts. All data fetched from existing backend
 * endpoints; degrades gracefully to mock data when the API is unavailable.
 */
import { useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2,
  RefreshCw, Download, Info,
} from 'lucide-react';
import {
  MOCK_CTES,
  MOCK_GAPS,
  MOCK_SUMMARY,
  type CteRow,
  useComplianceGapsQuery,
  useComplianceSummaryQuery,
  useCtesQuery,
} from '../hooks/useCompliance';

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
  const queryClient = useQueryClient();

  const summaryQuery = useComplianceSummaryQuery();
  const ctesQuery    = useCtesQuery();
  const gapsQuery    = useComplianceGapsQuery();

  // Fall back to mock data when the live API is unavailable so the page
  // remains useful even without a compliance backend.
  const summary = summaryQuery.data ?? MOCK_SUMMARY;
  const ctes    = ctesQuery.data    ?? MOCK_CTES;
  const gaps    = gapsQuery.data    ?? MOCK_GAPS;

  const isLoading   = summaryQuery.isPending || ctesQuery.isPending || gapsQuery.isPending;
  const isFetching  = summaryQuery.isFetching || ctesQuery.isFetching || gapsQuery.isFetching;
  const refreshing  = isFetching && !isLoading;
  const usingMocks  = summaryQuery.isError || ctesQuery.isError || gapsQuery.isError;

  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: ['compliance'] });
  }

  const handleExport = () => {
    alert('Export coming soon — will generate a PDF/CSV compliance report.');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-enterprise-gradient flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400" />
      </div>
    );
  }

  const ScoreIcon = summary.score >= 75 ? ShieldCheck : ShieldAlert;

  return (
    <div className="p-6 space-y-6 text-white">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">FSMA 204 Compliance Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Food Traceability Rule — Key Tracking & Critical Events</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
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

      {/* ── Banner: mock data warning ──────────────────────────────────── */}
      {usingMocks && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-400/10 border border-yellow-400/30 text-yellow-300 text-sm">
          <Info size={15} /> Live data unavailable — showing sample data.
        </div>
      )}

      {/* ── KPI row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        <div className={`rounded-xl border p-5 flex flex-col items-center gap-2 ${scoreBg(summary.score)}`}>
          <ScoreIcon size={28} className={scoreColor(summary.score)} />
          <span className={`text-4xl font-bold ${scoreColor(summary.score)}`}>{summary.score}</span>
          <span className="text-xs text-gray-400 uppercase tracking-wider">Compliance Score</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${scoreBg(summary.score)} ${scoreColor(summary.score)}`}>
            {scoreLabel(summary.score)}
          </span>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-2">
          <span className="text-xs text-gray-400 uppercase tracking-wider">KTE Coverage</span>
          <span className="text-3xl font-bold">{summary.kte_covered}<span className="text-gray-500 text-lg">/{summary.kte_total}</span></span>
          {pctBar(Math.round((summary.kte_covered / (summary.kte_total || 1)) * 100))}
          <span className="text-xs text-gray-500">Key Trading Entities verified</span>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-2">
          <span className="text-xs text-gray-400 uppercase tracking-wider">TLC Coverage</span>
          <span className="text-3xl font-bold">{summary.tlc_covered}<span className="text-gray-500 text-lg">/{summary.tlc_total}</span></span>
          {pctBar(Math.round((summary.tlc_covered / (summary.tlc_total || 1)) * 100))}
          <span className="text-xs text-gray-500">Traceability Lot Codes assigned</span>
        </div>

        <div className={`rounded-xl border p-5 flex flex-col items-center gap-2 ${summary.open_gaps === 0 ? 'bg-emerald-400/10 border-emerald-400/30' : 'bg-red-400/10 border-red-400/30'}`}>
          {summary.open_gaps === 0
            ? <CheckCircle2 size={28} className="text-emerald-400" />
            : <AlertTriangle size={28} className="text-red-400" />}
          <span className={`text-4xl font-bold ${summary.open_gaps === 0 ? 'text-emerald-400' : 'text-red-400'}`}>{summary.open_gaps}</span>
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
          {ctes.map((row) => (
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
              {gaps.map((g) => (
                <tr key={g.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="py-2 pr-4 text-white">{g.item}</td>
                  <td className="py-2 pr-4 text-gray-400">{g.location}</td>
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 rounded text-xs bg-white/10 text-gray-300 capitalize">{g.event_type}</span>
                  </td>
                  <td className="py-2 pr-4 text-gray-300">{g.gap_type}</td>
                  <td className="py-2 text-right">
                    <span className={`font-mono font-semibold ${g.days_open >= 5 ? 'text-red-400' : g.days_open >= 3 ? 'text-yellow-400' : 'text-gray-300'}`}>{g.days_open}d</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {gaps.length === 0 && summaryQuery.data && (
            <p className="text-center text-gray-500 py-6">No open gaps — all records complete ✓</p>
          )}
        </div>
      </div>

      {/* ── Footer timestamp ───────────────────────────────────────────── */}
      <p className="text-xs text-gray-600 text-right">
        Last updated: {new Date(summary.last_updated).toLocaleString()}
      </p>
    </div>
  );
}
