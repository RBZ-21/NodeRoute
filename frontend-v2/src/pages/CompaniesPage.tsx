import { useEffect, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type Company = {
  id: string;
  name: string;
  slug?: string;
  plan?: string;
  status?: 'active' | 'suspended' | 'trial';
  user_count?: number;
  admin_email?: string;
  created_at?: string;
  last_activity?: string;
};

type CompanyStats = {
  total: number;
  active: number;
  trial: number;
  suspended: number;
};

function money(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  trial:     'bg-amber-100 text-amberald-700 border-amber-200',
  suspended: 'bg-red-100 text-red-700 border-red-200',
};

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'trial' | 'suspended'>('all');
  const [impersonating, setImpersonating] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Company[]>('/api/superadmin/companies');
      setCompanies(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load companies'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const stats: CompanyStats = {
    total:     companies.length,
    active:    companies.filter((c) => c.status === 'active').length,
    trial:     companies.filter((c) => c.status === 'trial').length,
    suspended: companies.filter((c) => c.status === 'suspended').length,
  };

  const filtered = companies.filter((c) => {
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.admin_email ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.slug ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function impersonate(company: Company) {
    setImpersonating(company.id);
    try {
      const res = await fetchWithAuth<{ token: string; user: unknown }>(
        `/api/superadmin/companies/${company.id}/impersonate`,
      );
      // Store current superadmin session so we can restore it
      const prevToken = localStorage.getItem('nr_token');
      const prevUser  = localStorage.getItem('nr_user');
      if (prevToken) sessionStorage.setItem('sa_prev_token', prevToken);
      if (prevUser)  sessionStorage.setItem('sa_prev_user', prevUser);
      localStorage.setItem('nr_token', res.token);
      localStorage.setItem('nr_user', JSON.stringify(res.user));
      window.location.href = '/dashboard';
    } catch (err) {
      alert(`Could not switch to ${company.name}: ${(err as Error).message}`);
    } finally {
      setImpersonating(null);
    }
  }

  async function toggleSuspend(company: Company) {
    const next = company.status === 'suspended' ? 'active' : 'suspended';
    if (!confirm(`Set ${company.name} to ${next}?`)) return;
    try {
      await fetchWithAuth(`/api/superadmin/companies/${company.id}/status?status=${next}`);
      await load();
    } catch (err) {
      alert(String((err as Error).message));
    }
  }

  return (
    <div className="space-y-5">
      {/* ── SuperAdmin banner ── */}
      <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
        <strong>SuperAdmin View</strong> — You are viewing all tenant companies across the NodeRoute platform.
        Use <strong>Inspect</strong> to temporarily switch into a company's context for troubleshooting.
      </div>

      {loading && <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading companies…</div>}
      {error   && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}

      {/* ── Stats ── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Companies" value={stats.total.toLocaleString()} color="" />
        <StatCard label="Active"          value={stats.active.toLocaleString()} color="text-emerald-600" />
        <StatCard label="Trial"           value={stats.trial.toLocaleString()} color="text-amber-600" />
        <StatCard label="Suspended"       value={stats.suspended.toLocaleString()} color="text-red-600" />
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Tenant Companies</CardTitle>
            <CardDescription>All businesses using the NodeRoute platform.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              placeholder="Search name, email, slug…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="suspended">Suspended</option>
            </select>
            <Button variant="outline" onClick={load}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="table-scroll-container overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Admin Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? filtered.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium">
                      <div>{company.name}</div>
                      {company.slug && <div className="text-xs text-muted-foreground font-mono">{company.slug}</div>}
                    </TableCell>
                    <TableCell>{company.admin_email || '—'}</TableCell>
                    <TableCell>{company.plan || '—'}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[company.status ?? ''] ?? 'bg-muted text-muted-foreground border-border'}`}>
                        {company.status ?? 'unknown'}
                      </span>
                    </TableCell>
                    <TableCell>{company.user_count ?? '—'}</TableCell>
                    <TableCell>{company.created_at ? new Date(company.created_at).toLocaleDateString() : '—'}</TableCell>
                    <TableCell>{company.last_activity ? new Date(company.last_activity).toLocaleDateString() : '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={impersonating === company.id}
                          onClick={() => impersonate(company)}
                        >
                          {impersonating === company.id ? 'Switching…' : 'Inspect'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={company.status === 'suspended' ? 'text-emerald-600' : 'text-red-600'}
                          onClick={() => toggleSuspend(company)}
                        >
                          {company.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground">
                      No companies match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-2xl ${color}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
