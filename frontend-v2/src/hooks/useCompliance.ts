import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api';

export type ComplianceSummary = {
  score: number;
  kte_covered: number;
  kte_total: number;
  tlc_covered: number;
  tlc_total: number;
  open_gaps: number;
  last_updated: string;
};

export type CteRow = {
  event_type: 'harvest' | 'cooling' | 'packing' | 'shipping' | 'receiving';
  total: number;
  complete: number;
  pct: number;
};

export type GapRow = {
  id: string;
  item: string;
  location: string;
  event_type: string;
  gap_type: string;
  days_open: number;
};

// ── Mock fallbacks (used when the live API is unavailable) ────────────────────

export const MOCK_SUMMARY: ComplianceSummary = {
  score: 74,
  kte_covered: 38,
  kte_total: 52,
  tlc_covered: 210,
  tlc_total: 248,
  open_gaps: 14,
  last_updated: new Date().toISOString(),
};

export const MOCK_CTES: CteRow[] = [
  { event_type: 'harvest',   total: 80,  complete: 72, pct: 90 },
  { event_type: 'cooling',   total: 75,  complete: 58, pct: 77 },
  { event_type: 'packing',   total: 80,  complete: 61, pct: 76 },
  { event_type: 'shipping',  total: 110, complete: 98, pct: 89 },
  { event_type: 'receiving', total: 110, complete: 85, pct: 77 },
];

export const MOCK_GAPS: GapRow[] = [
  { id: '1', item: 'Atlantic Salmon (10 lb)',  location: 'Cold Storage A', event_type: 'cooling',   gap_type: 'Missing temp log',     days_open: 3 },
  { id: '2', item: 'Gulf Shrimp (5 lb)',       location: 'Dock 2',         event_type: 'receiving', gap_type: 'No TLC assigned',      days_open: 1 },
  { id: '3', item: 'Yellowfin Tuna (20 lb)',   location: 'Cold Storage B', event_type: 'packing',   gap_type: 'Supplier KTE missing', days_open: 5 },
  { id: '4', item: 'Mahi-Mahi (8 lb)',         location: 'Dock 1',         event_type: 'harvest',   gap_type: 'Harvest date missing', days_open: 2 },
  { id: '5', item: 'Red Snapper (12 lb)',      location: 'Dock 3',         event_type: 'shipping',  gap_type: 'Receiver KTE missing', days_open: 7 },
  { id: '6', item: 'Grouper (15 lb)',          location: 'Cold Storage A', event_type: 'packing',   gap_type: 'No TLC assigned',      days_open: 4 },
  { id: '7', item: 'Flounder (6 lb)',          location: 'Dock 2',         event_type: 'cooling',   gap_type: 'Missing temp log',     days_open: 1 },
  { id: '8', item: 'Wahoo (18 lb)',            location: 'Cold Storage C', event_type: 'receiving', gap_type: 'No TLC assigned',      days_open: 6 },
];

// ── Queries ───────────────────────────────────────────────────────────────────

export function useComplianceSummaryQuery() {
  return useQuery({
    queryKey: ['compliance', 'summary'] as const,
    queryFn: () => fetchWithAuth<ComplianceSummary>('/api/compliance/summary'),
    staleTime: 30_000,
  });
}

export function useCtesQuery() {
  return useQuery({
    queryKey: ['compliance', 'ctes'] as const,
    queryFn: () => fetchWithAuth<CteRow[]>('/api/compliance/cte-completeness'),
    staleTime: 30_000,
  });
}

export function useComplianceGapsQuery() {
  return useQuery({
    queryKey: ['compliance', 'gaps'] as const,
    queryFn: () => fetchWithAuth<GapRow[]>('/api/compliance/gaps'),
    staleTime: 30_000,
  });
}
