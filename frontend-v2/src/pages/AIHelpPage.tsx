import { Lightbulb, ListChecks, ShieldAlert, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { sendWithAuth } from '../lib/api';

type WalkthroughResponse = {
  title?: string;
  summary?: string;
  steps?: string[];
  tips?: string[];
  warnings?: string[];
};

type FeatureOption = {
  label: string;
  value: string;
};

const featureOptions: FeatureOption[] = [
  { label: 'Dashboard Overview', value: 'Dashboard' },
  { label: 'Orders', value: 'Orders' },
  { label: 'Deliveries', value: 'Deliveries' },
  { label: 'Drivers', value: 'Drivers' },
  { label: 'Routes', value: 'Routes' },
  { label: 'Stops', value: 'Stops' },
  { label: 'Customers', value: 'Customers' },
  { label: 'Vendors', value: 'Vendors' },
  { label: 'Planning', value: 'Planning' },
  { label: 'Purchasing', value: 'Purchasing' },
  { label: 'Warehouse', value: 'Warehouse' },
  { label: 'Invoices', value: 'Invoices' },
  { label: 'Analytics', value: 'Analytics' },
  { label: 'Reporting', value: 'Reporting' },
  { label: 'Portal Payments', value: 'Portal Payments' },
  { label: 'Inventory', value: 'Inventory' },
  { label: 'Forecasting', value: 'Forecasting' },
  { label: 'Settings', value: 'Settings' },
];

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

export function AIHelpPage() {
  const [feature, setFeature] = useState<string>(featureOptions[0].value);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<WalkthroughResponse | null>(null);

  const outputTitle = useMemo(() => {
    if (result?.title?.trim()) return result.title.trim();
    return feature ? `${feature} Walkthrough` : 'Walkthrough';
  }, [feature, result?.title]);

  async function requestWalkthrough() {
    if (!feature.trim()) {
      setError('Choose a function first.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await sendWithAuth<WalkthroughResponse>('/api/ai/walkthrough', 'POST', {
        feature: feature.trim(),
        question: question.trim(),
      });
      setResult({
        title: String(data?.title || '').trim(),
        summary: String(data?.summary || '').trim(),
        steps: normalizeList(data?.steps),
        tips: normalizeList(data?.tips),
        warnings: normalizeList(data?.warnings),
      });
    } catch (err) {
      setError(String((err as Error).message || 'AI walkthrough failed'));
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFeature(featureOptions[0].value);
    setQuestion('');
    setError('');
    setResult(null);
  }

  return (
    <div className="space-y-5">
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>AI Walkthroughs</CardTitle>
            <CardDescription>Ask for a plain-English walkthrough of any NodeRoute function.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Function</span>
              <select
                value={feature}
                onChange={(event) => setFeature(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {featureOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Optional Question</span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Example: How do I create an order, assign a driver, and invoice it?"
                rows={6}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button onClick={requestWalkthrough} disabled={loading}>
                {loading ? 'Generating Walkthrough...' : 'Get Walkthrough'}
              </Button>
              <Button variant="outline" onClick={resetForm} disabled={loading}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>{outputTitle}</CardTitle>
            <CardDescription>
              {result?.summary?.trim()
                ? result.summary
                : 'Choose a function and request a walkthrough to see steps, tips, and warnings.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InsightSection
              title="Steps"
              icon={<ListChecks className="h-4 w-4" />}
              items={normalizeList(result?.steps)}
              emptyText="No steps yet."
              tone="blue"
            />
            <InsightSection
              title="Tips"
              icon={<Lightbulb className="h-4 w-4" />}
              items={normalizeList(result?.tips)}
              emptyText="No tips yet."
              tone="emerald"
            />
            <InsightSection
              title="Warnings"
              icon={<ShieldAlert className="h-4 w-4" />}
              items={normalizeList(result?.warnings)}
              emptyText="No warnings yet."
              tone="amber"
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Usage Notes
          </CardTitle>
          <CardDescription>The walkthrough endpoint uses role-aware guidance and may return fallback advice when AI configuration is limited.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          When `OPENAI_API_KEY` is missing, the backend can return service availability or fallback guidance depending on environment setup.
        </CardContent>
      </Card>
    </div>
  );
}

function InsightSection({
  title,
  icon,
  items,
  emptyText,
  tone,
}: {
  title: string;
  icon: JSX.Element;
  items: string[];
  emptyText: string;
  tone: 'blue' | 'emerald' | 'amber';
}) {
  const toneClass =
    tone === 'blue'
      ? 'border-blue-200 bg-blue-50 text-blue-800'
      : tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-amber-200 bg-amber-50 text-amber-800';

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {items.length ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ol>
      ) : (
        <div className="mt-2 text-sm opacity-80">{emptyText}</div>
      )}
    </div>
  );
}
