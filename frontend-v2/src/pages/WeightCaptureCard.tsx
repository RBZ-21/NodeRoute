import { useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { sendWithAuth } from '../lib/api';

interface WeightCaptureCardProps {
  stopId: string | number;
  currentWeight?: number | null;
  onSaved?: (weightLbs: number) => void;
}

export function WeightCaptureCard({ stopId, currentWeight, onSaved }: WeightCaptureCardProps) {
  const [weight, setWeight] = useState<string>(currentWeight != null ? String(currentWeight) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    const lbs = parseFloat(weight);
    if (isNaN(lbs) || lbs <= 0) {
      setError('Enter a valid weight in lbs');
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await sendWithAuth(`/api/stops/${stopId}/weight`, 'POST', { weight_lbs: lbs });
      setSaved(true);
      onSaved?.(lbs);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(String((err as Error).message || 'Failed to save weight'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Capture Weight</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <div className="rounded border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>
        ) : null}
        {saved ? (
          <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Weight saved ✓</div>
        ) : null}
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            type="number"
            min="0"
            step="0.01"
            placeholder="lbs"
            value={weight}
            onChange={(e) => { setWeight(e.target.value); setError(''); }}
            className="w-32"
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
          />
          <span className="flex items-center text-sm text-muted-foreground">lbs</span>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Weight'}
          </Button>
        </div>
        {currentWeight != null && !saved ? (
          <p className="text-xs text-muted-foreground">Last recorded: {currentWeight} lbs</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
