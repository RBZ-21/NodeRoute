import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { type PlanningRule, type RuleStatus, useDeleteRule, usePlanningRules, useToggleRule } from '../hooks/usePlanning';

const statusColors = { active: 'green', inactive: 'gray', draft: 'yellow' } as const;

export function PlanningPage() {
  const { data, isLoading, isError, error } = usePlanningRules();
  const rules = useMemo(() => data?.rules ?? [], [data]);
  const endpoint = data?.endpoint ?? '';
  const endpointUnavailable = data?.endpointUnavailable ?? false;

  const toggleRule = useToggleRule(endpoint);
  const deleteRule = useDeleteRule(endpoint);

  const [typeFilter, setTypeFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RuleStatus>('all');
  const [notice, setNotice] = useState('');

  const typeOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const rule of rules) { if (rule.type) unique.add(rule.type); }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rules]);

  const filtered = useMemo(
    () => rules.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    }),
    [rules, typeFilter, statusFilter]
  );

  async function handleToggle(rule: PlanningRule) {
    const nextStatus: RuleStatus = rule.status === 'active' ? 'inactive' : 'active';
    try {
      await toggleRule.mutateAsync({ id: rule.id, nextStatus });
      setNotice(`Rule ${rule.name} is now ${nextStatus}.`);
    } catch (err) { setNotice(String((err as Error)?.message || 'Could not update rule')); }
  }

  async function handleDelete(rule: PlanningRule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await deleteRule.mutateAsync(rule.id);
      setNotice(`Deleted rule ${rule.name}.`);
    } catch (err) { setNotice(String((err as Error)?.message || 'Could not delete rule')); }
  }

  if (isLoading) return <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading planning rules...</div>;
  if (isError) return <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message)}</div>;

  if (endpointUnavailable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Rules Configured</CardTitle>
          <CardDescription>No rules endpoint is available yet. Configure your first planning rule to start automation.</CardDescription>
        </CardHeader>
        <CardContent><Button onClick={() => setNotice('New rule builder opened.')}>Create First Rule</Button></CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {notice && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Planning &amp; Rules</CardTitle>
            <CardDescription>Active routing and delivery rules from <span className="font-semibold">{endpoint || '/api/planning/rules'}</span>.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</span>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All Types</option>
                {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | RuleStatus)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="draft">Draft</option>
              </select>
            </label>
            <Button onClick={() => setNotice('New rule builder opened.')}>New Rule</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule ID</TableHead><TableHead>Rule Name</TableHead><TableHead>Type</TableHead>
                <TableHead>Condition</TableHead><TableHead>Action</TableHead>
                <TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((rule) => {
                const busy = toggleRule.isPending || deleteRule.isPending;
                return (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.id}</TableCell>
                    <TableCell>{rule.name}</TableCell>
                    <TableCell>{rule.type}</TableCell>
                    <TableCell>{rule.condition}</TableCell>
                    <TableCell>{rule.action}</TableCell>
                    <TableCell>{rule.priority.toLocaleString()}</TableCell>
                    <TableCell><StatusBadge status={rule.status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setNotice(`Editing rule ${rule.name}.`)} disabled={busy}>Edit Rule</Button>
                        <Button variant="secondary" size="sm" onClick={() => handleToggle(rule)} disabled={busy}>
                          {rule.status === 'active' ? 'Set Inactive' : 'Set Active'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(rule)} disabled={busy}>Delete Rule</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow><TableCell colSpan={8} className="text-muted-foreground">No rules match the current filters.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
