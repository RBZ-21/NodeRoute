import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useDashboardLayout, useSaveDashboardLayout } from '../hooks/useUserPreferences';

const VIEW_TYPES = ['inventory', 'customer', 'vendor', 'salesperson', 'brand', 'class'] as const;
const WIDGETS = [
  { key: 'summary', label: 'Summary' },
  { key: 'trend', label: 'Trend' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'routes', label: 'Routes' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'purchasing', label: 'Purchasing' },
] as const;

type ViewType = typeof VIEW_TYPES[number];

function defaultWidgets() {
  return Object.fromEntries(WIDGETS.map((widget) => [widget.key, true])) as Record<string, boolean>;
}

export function DashboardBuilderPage() {
  const [viewType, setViewType] = useState<ViewType>('inventory');
  const layoutQuery = useDashboardLayout(viewType);
  const saveLayout = useSaveDashboardLayout();
  const [widgets, setWidgets] = useState<Record<string, boolean>>(defaultWidgets);

  const loadedWidgets = useMemo(
    () => layoutQuery.data?.layout?.widgets || {},
    [layoutQuery.data?.layout?.widgets],
  );

  useEffect(() => {
    setWidgets({ ...defaultWidgets(), ...loadedWidgets });
  }, [loadedWidgets, viewType]);

  function toggleWidget(key: string) {
    setWidgets((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleSave() {
    await saveLayout.mutateAsync({
      view_type: viewType,
      layout: { widgets },
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard Builder</h1>
        </div>
        <Button onClick={() => void handleSave()} disabled={saveLayout.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {saveLayout.isPending ? 'Saving...' : 'Save Layout'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Layout</CardTitle>
          <CardDescription>Inventory, customer, vendor, salesperson, brand, and class.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="flex max-w-xs flex-col gap-1.5 text-sm">
            <span className="font-semibold text-muted-foreground">View</span>
            <select
              value={viewType}
              onChange={(event) => setViewType(event.target.value as ViewType)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {VIEW_TYPES.map((view) => (
                <option key={view} value={view}>{view}</option>
              ))}
            </select>
          </label>

          {layoutQuery.isLoading ? (
            <div className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Loading layout...</div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WIDGETS.map((widget) => (
              <label
                key={widget.key}
                className="flex min-h-12 items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={widgets[widget.key] !== false}
                  onChange={() => toggleWidget(widget.key)}
                  className="h-4 w-4"
                />
                <span className="font-medium">{widget.label}</span>
              </label>
            ))}
          </div>

          {saveLayout.isSuccess ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Layout saved.</div>
          ) : null}
          {saveLayout.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {(saveLayout.error as Error).message || 'Could not save layout.'}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
