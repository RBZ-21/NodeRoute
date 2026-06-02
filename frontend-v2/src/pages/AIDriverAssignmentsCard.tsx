import { memo } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import type { AssignmentsResult } from '../hooks/useRoutes';

type Props = {
  result: AssignmentsResult | null;
  suggesting: boolean;
  applying: boolean;
  onSuggest: () => void;
  onApply: (routeId: string, recommendedDriverName: string) => void;
};

/**
 * AI driver-assignment suggestions. Presentational + memoized: the parent
 * owns the mutation and result state and passes them down, so this card
 * (and its table) only re-renders when the suggestions or pending flags
 * actually change — not on every keystroke elsewhere on the routes page.
 */
function AIDriverAssignmentsCardImpl({ result, suggesting, applying, onSuggest, onApply }: Props) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">❆ AI Driver Assignments</CardTitle>
          <CardDescription>AI suggests the best driver for each unassigned route based on workload and history.</CardDescription>
        </div>
        <Button onClick={onSuggest} disabled={suggesting} variant="outline" size="sm">
          {suggesting ? 'Analyzing…' : 'Suggest Assignments'}
        </Button>
      </CardHeader>
      {result && (
        <CardContent className="space-y-3">
          {result.summary && <p className="text-sm text-muted-foreground">{result.summary}</p>}
          {result.assignments.length > 0 ? (
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead>Suggested Driver</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Reasoning</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.assignments.map((a) => (
                    <TableRow key={a.route_id}>
                      <TableCell className="font-medium">{a.route_name}</TableCell>
                      <TableCell>{a.recommended_driver_name}</TableCell>
                      <TableCell>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${a.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : a.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                          {a.confidence}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.reasoning}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onApply(a.route_id, a.recommended_driver_name)}
                          disabled={applying}
                        >
                          Apply
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No assignment suggestions generated.</p>}
        </CardContent>
      )}
    </Card>
  );
}

export const AIDriverAssignmentsCard = memo(AIDriverAssignmentsCardImpl);
