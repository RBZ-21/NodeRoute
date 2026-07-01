import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { TableEmptyState } from '../components/ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type KitRecipe = {
  id: string;
  name?: string;
  output_qty?: number | string;
  output_uom?: string;
  is_active?: boolean;
};

type KitRun = {
  id: string;
  kit_recipe_id?: string;
  run_date?: string;
  quantity_produced?: number | string;
  status?: string;
  ledger_group_id?: string;
  created_at?: string;
};

function asNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

export function KitsPage() {
  const queryClient = useQueryClient();
  const recipesQuery = useQuery({
    queryKey: ['kits', 'recipes'] as const,
    queryFn: () => fetchWithAuth<KitRecipe[]>('/api/kits/recipes').then((rows) => Array.isArray(rows) ? rows : []),
    staleTime: 30_000,
  });
  const runsQuery = useQuery({
    queryKey: ['kits', 'runs'] as const,
    queryFn: () => fetchWithAuth<KitRun[]>('/api/kits/runs').then((rows) => Array.isArray(rows) ? rows : []),
    staleTime: 30_000,
  });

  const runMutation = useMutation({
    mutationFn: (recipeId: string) =>
      sendWithAuth('/api/kits/process', 'POST', {
        kit_recipe_id: recipeId,
        quantity_produced: 1,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kits'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const recipes = recipesQuery.data ?? [];
  const runs = runsQuery.data ?? [];

  return (
    <div className="space-y-5">
      {recipesQuery.isError || runsQuery.isError ? (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {String((recipesQuery.error as Error)?.message || (runsQuery.error as Error)?.message || 'Could not load kits')}
        </div>
      ) : null}
      {runMutation.isError ? (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {String((runMutation.error as Error)?.message || 'Kit processing failed')}
        </div>
      ) : null}
      {runMutation.isSuccess ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Kit run posted.</div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Kit Recipes</CardTitle>
            <CardDescription>In-house processing recipes and output quantities.</CardDescription>
          </div>
          <Button
            onClick={() => recipes[0]?.id && runMutation.mutate(recipes[0].id)}
            disabled={!recipes.length || runMutation.isPending}
          >
            Run First Active Kit
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Output</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipes.map((recipe) => (
                <TableRow key={recipe.id}>
                  <TableCell className="font-medium">{recipe.name || recipe.id}</TableCell>
                  <TableCell>{asNumber(recipe.output_qty).toLocaleString()} {recipe.output_uom || ''}</TableCell>
                  <TableCell>{recipe.is_active === false ? 'Inactive' : 'Active'}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => runMutation.mutate(recipe.id)} disabled={runMutation.isPending || recipe.is_active === false}>
                      Run
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!recipes.length ? (
                <TableEmptyState
                  colSpan={4}
                  title="No kit recipes yet."
                  description="Refresh recipes after adding kit setup data."
                  actionLabel="Refresh Recipes"
                  onAction={() => void recipesQuery.refetch()}
                />
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Processing Runs</CardTitle>
          <CardDescription>Recent kit output and ledger groups.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ledger Group</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>{run.run_date || String(run.created_at || '').slice(0, 10) || '-'}</TableCell>
                  <TableCell>{asNumber(run.quantity_produced).toLocaleString()}</TableCell>
                  <TableCell>{run.status || '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{run.ledger_group_id || '-'}</TableCell>
                </TableRow>
              ))}
              {!runs.length ? (
                <TableEmptyState
                  colSpan={4}
                  title="No processing runs yet."
                  description="Run an active kit recipe to create processing history."
                  actionLabel={recipes.length ? 'Run First Active Kit' : 'Refresh Runs'}
                  onAction={() => { if (recipes[0]?.id) runMutation.mutate(recipes[0].id); else void runsQuery.refetch(); }}
                />
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
