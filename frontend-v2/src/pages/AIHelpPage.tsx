import { useState } from 'react';
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

const features = ['Orders', 'Deliveries', 'Routes', 'Inventory', 'Invoices', 'Drivers', 'Settings'];

export function AIHelpPage() {
  const [feature, setFeature] = useState(features[0]);
  const [question, setQuestion] = useState('');
  const [walkthrough, setWalkthrough] = useState<WalkthroughResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function requestWalkthrough(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await sendWithAuth<WalkthroughResponse>('/api/ai/walkthrough', 'POST', { feature, question });
      setWalkthrough(response);
    } catch (err) {
      setError(String((err as Error).message || 'Could not generate walkthrough'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>AI Walkthroughs</CardTitle>
          <CardDescription>Generate guided operational help from `/api/ai/walkthrough`.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 lg:grid-cols-[220px_1fr_auto]" onSubmit={requestWalkthrough}>
            <select value={feature} onChange={(event) => setFeature(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              {features.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What do you need help with?" />
            <Button type="submit" disabled={loading}>{loading ? 'Generating...' : 'Generate'}</Button>
          </form>
        </CardContent>
      </Card>

      {walkthrough ? (
        <Card>
          <CardHeader>
            <CardTitle>{walkthrough.title || `${feature} Walkthrough`}</CardTitle>
            <CardDescription>{walkthrough.summary || 'Operational guidance generated for the selected feature.'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Section title="Steps" items={walkthrough.steps} ordered />
            <Section title="Tips" items={walkthrough.tips} />
            <Section title="Warnings" items={walkthrough.warnings} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Ready When You Are</CardTitle>
            <CardDescription>Select a feature, ask a practical question, and the backend fallback will still return guidance if no AI key is configured.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function Section({ title, items, ordered }: { title: string; items?: string[]; ordered?: boolean }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;

  const Tag = ordered ? 'ol' : 'ul';
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <Tag className={ordered ? 'list-decimal space-y-2 pl-5 text-sm' : 'list-disc space-y-2 pl-5 text-sm'}>
        {list.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </Tag>
    </section>
  );
}
