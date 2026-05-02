import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { fetchWithAuth } from '../lib/api';
import { WeightCaptureCard } from './WeightCaptureCard';

type StopRow = {
  id: string | number;
  address?: string;
  customer_id?: string | number;
  status?: string;
  weight_lbs?: number | null;
  weight_captured_at?: string | null;
  weight_captured_by?: string | null;
  route_id?: string | number;
};

interface OrderWeightsBoardProps {
  // routeId is required — rendering this board without a route filter would
  // expose every stop in the system to the current user.
  routeId: string | number;
}

export function OrderWeightsBoard({ routeId }: OrderWeightsBoardProps) {
  const [stops, setStops] = useState<StopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeStopId, setActiveStopId] = useState<string | number | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ route_id: String(routeId) });
      const data = await fetchWithAuth<StopRow[]>(`/api/stops?${params.toString()}`);
      setStops(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load stops'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [routeId]);

  function onWeightSaved(stopId: string | number, lbs: number) {
    setStops((prev) =>
      prev.map((s) =>
        s.id === stopId
          ? { ...s, weight_lbs: lbs, weight_captured_at: new Date().toISOString() }
          : s
      )
    );
    setActiveStopId(null);
  }

  return (
    <div className="space-y-4">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading stops...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Order Weights Board</CardTitle>
          <CardDescription>Capture and review delivery weights for route {routeId}.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stop</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Weight (lbs)</TableHead>
                <TableHead>Captured By</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stops.length ? stops.map((stop) => (
                <TableRow key={String(stop.id)}>
                  <TableCell className="font-medium">{stop.id}</TableCell>
                  <TableCell>{stop.address || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={stop.status === 'completed' ? 'success' : 'secondary'}>
                      {stop.status || 'pending'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {stop.weight_lbs != null ? (
                      <span className="font-semibold">{stop.weight_lbs} lbs</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {stop.weight_captured_by || '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={activeStopId === stop.id ? 'default' : 'outline'}
                      onClick={() => setActiveStopId(activeStopId === stop.id ? null : stop.id)}
                    >
                      {activeStopId === stop.id ? 'Cancel' : 'Enter Weight'}
                    </Button>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">No stops found for this route.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {activeStopId != null ? (
        <WeightCaptureCard
          stopId={activeStopId}
          currentWeight={stops.find((s) => s.id === activeStopId)?.weight_lbs}
          onSaved={(lbs) => onWeightSaved(activeStopId, lbs)}
        />
      ) : null}

      <div className="flex justify-end">
        <Button variant="outline" onClick={load}>Refresh</Button>
      </div>
    </div>
  );
}
