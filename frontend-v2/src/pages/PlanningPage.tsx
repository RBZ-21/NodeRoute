import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type RuleStatus = 'active' | 'inactive' | 'draft' | 'other';

type PlanningRule = {
  id: string;
  name: string;
  type: string;
  condition: string;
  action: string;
  priority: number;
  status: RuleStatus;
};

const statusColors = {
  active: 'green',
  inactive: 'gray',
  draft: 'yellow',
} as const;

function normalizeStatus(value: string | undefined): RuleStatus {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (normalized === 'active') return 'active';
  if (normalized === 'inactive') return 'inactive';
  if (normalized === 'draft') return 'draft';
  return 'other';
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickString(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
}

function toRule(raw: unknown, index: number): PlanningRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  return {
    id: pickString(record, ['id', 'ruleId', 'rule_id'], `RULE-${index + 1}`),
    name: pickString(record, ['name', 'ruleName', 'rule_name'], `Rule ${index + 1}`),
    type: pickString(record, ['type', 'ruleType', 'rule_type'], 'General'),
    condition: pickString(record, ['condition', 'when', 'criteria'], '-'),
    action: pickString(record, ['action', 'then', 'outcome'], '-'),
    priority: toNumber(record.priority),
    status: normalizeStatus(pickString(record, ['status', 'state'])),
  };
}

function parseRules(data: unknown): PlanningRule[] {
  if (Array.isArray(data)) {
    return data.map(toRule).filter((rule): rule is PlanningRule => !!rule);
  }
  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  const candidates = [root.rules, root.items, root.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(toRule).filter((rule): rule is PlanningRule => !!rule);
    }
  }
  return [];
}

async function loadRulesData() {
  try {
    const data = await fetchWithAuth<unknown>('/api/planning/rules');
    return { endpoint: '/api/planning/rules', rules: parseRules(data), endpointUnavailable: false };
  } catch {
    try {
      const data = await fetchWithAuth<unknown>('/api/settings/rules');
      return { endpoint: '/api/settings/rules', rules: parseRules(data), endpointUnavailable: false };
    } catch {
      return { endpoint: '', rules: [], endpointUnavailable: true };
    }
  }
}

export function PlanningPage() {
  const [rules, setRules] = useState<PlanningRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [endpointUnavailable, setEndpointUnavailable] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RuleStatus>('all');
  const [pendingById, setPendingById] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await loadRulesData();
      setRules(response.rules);
      setEndpoint(response.endpoint);
      setEndpointUnavailable(response.endpointUnavailable);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load planning rules'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const typeOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const rule of rules) {
      if (rule.type) unique.add(rule.type);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rules]);

  const filtered = useMemo(() => {
    return rules.filter((rule) => {
      if (typeFilter !== 'all' && rule.type !== typeFilter) return false;
      if (statusFilter !== 'all' && rule.status !== statusFilter) return false;
      return true;
    });
  }, [rules, typeFilter, statusFilter]);

  function setPending(id: string, active: boolean) {
    setPendingById((current) => {
      if (!active) {
        const { [id]: _, ...rest } = current;
        return rest;
      }
      return { ...current, [id]: true };
    });
  }

  function newRule() {
    setNotice('New rule builder opened.');
  }

  function editRule(rule: PlanningRule) {
    setNotice(`Editing rule ${rule.name}.`);
  }

  async function toggleRule(rule: PlanningRule) {
    if (!endpoint) return;
    const nextStatus: RuleStatus = rule.status === 'active' ? 'inactive' : 'active';
    setError('');
    setNotice('');
    setPending(rule.id, true);
    try {
      await sendWithAuth(`${endpoint}/${encodeURIComponent(rule.id)}`, 'PATCH', { status: nextStatus });
      setRules((current) => current.map((currentRule) => (currentRule.id === rule.id ? { ...currentRule, status: nextStatus } : currentRule)));
      setNotice(`Rule ${rule.name} is now ${nextStatus}.`);
    } catch (err) {
      setError(String((err as Error).message || 'Could not update rule status'));
    } finally {
      setPending(rule.id, false);
    }
  }

  async function deleteRule(rule: PlanningRule) {
    if (!endpoint) return;
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    setError('');
    setNotice('');
    setPending(rule.id, true);
    try {
      await sendWithAuth(`${endpoint}/${encodeURIComponent(rule.id)}`, 'DELETE');
      setRules((current) => current.filter((currentRule) => currentRule.id !== rule.id));
      setNotice(`Deleted rule ${rule.name}.`);
    } catch (err) {
      setError(String((err as Error).message || 'Could not delete rule'));
    } finally {
      setPending(rule.id, false);
    }
  }

  if (endpointUnavailable) {
    return (
      <div className="space-y-5">
        {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading planning rules...</div> : null}
        {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
        {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}
        <Card>
          <CardHeader>
            <CardTitle>No Rules Configured</CardTitle>
            <CardDescription>No rules endpoint is available yet. Configure your first planning rule to start automation.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={newRule}>Create First Rule</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading planning rules...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Planning & Rules</CardTitle>
            <CardDescription>
              Active routing and delivery rules from <span className="font-semibold">{endpoint || '/api/planning/rules'}</span>.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</span>
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Types</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | RuleStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="draft">Draft</option>
              </select>
            </label>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
            <Button onClick={newRule}>New Rule</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule ID</TableHead>
                <TableHead>Rule Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.id}</TableCell>
                    <TableCell>{rule.name}</TableCell>
                    <TableCell>{rule.type}</TableCell>
                    <TableCell>{rule.condition}</TableCell>
                    <TableCell>{rule.action}</TableCell>
                    <TableCell>{rule.priority.toLocaleString()}</TableCell>
                    <TableCell>
                      <StatusBadge status={rule.status} colorMap={statusColors} fallbackLabel="Unknown" />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" onClick={() => editRule(rule)} disabled={!!pendingById[rule.id]}>
                          Edit Rule
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => toggleRule(rule)} disabled={!!pendingById[rule.id]}>
                          {rule.status === 'active' ? 'Set Inactive' : 'Set Active'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteRule(rule)} disabled={!!pendingById[rule.id]}>
                          Delete Rule
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No rules match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
