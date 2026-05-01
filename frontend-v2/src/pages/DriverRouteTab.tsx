import { Camera, CheckCircle2, ClipboardList, FileSignature, MapPin } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { dwellForStop, formatDateTime, routeProgress, stopBadgeVariant, stopStatus } from './driver.types';
import type { CompanySettings, DriverRoute, DwellRecord } from './driver.types';

type Props = {
  activeRoute: DriverRoute;
  dwellRecords: DwellRecord[];
  busyStopId: string;
  companySettings: CompanySettings;
  onArrive: (stopId: string) => void;
  onDepart: (stopId: string) => void;
  onOpenSignature: (stopId: string) => void;
  onUploadProofOfDelivery: (stopId: string) => void;
  onDownloadInvoice: (invoiceId: string) => void;
};

export function DriverRouteTab({
  activeRoute, dwellRecords, busyStopId, companySettings,
  onArrive, onDepart, onOpenSignature, onUploadProofOfDelivery, onDownloadInvoice,
}: Props) {
  const stops = activeRoute.stops || [];
  const progress = routeProgress(stops, dwellRecords, activeRoute.id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>{activeRoute.name || `Route ${activeRoute.id.slice(0, 8)}`}</CardTitle>
              <CardDescription>
                {progress.completed} of {progress.total} stops completed
              </CardDescription>
            </div>
            <Badge variant={progress.completed === progress.total && progress.total > 0 ? 'success' : 'secondary'}>
              {progress.percent}% complete
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress.percent}%` }} />
          </div>
        </CardContent>
      </Card>

      {stops.map((stop, index) => {
        const status = stopStatus(stop, activeRoute.id, dwellRecords);
        const record = dwellForStop(stop.id, activeRoute.id, dwellRecords);
        const isBusy = busyStopId === stop.id;
        return (
          <Card key={stop.id} className={status === 'arrived' ? 'border-blue-300' : status === 'completed' ? 'border-emerald-300' : ''}>
            <CardContent className="p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                      {index + 1}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{stop.name || `Stop ${index + 1}`}</div>
                      <div className="text-sm text-muted-foreground">{stop.address || 'Address unavailable'}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={stopBadgeVariant(status)}>{status}</Badge>
                    {stop.door_code ? <Badge variant="warning">Door code {stop.door_code}</Badge> : null}
                    {stop.invoice_number ? <Badge variant="neutral">Invoice {stop.invoice_number}</Badge> : null}
                  </div>
                  {stop.notes ? <div className="text-sm text-muted-foreground">Notes: {stop.notes}</div> : null}
                  {record?.arrivedAt ? (
                    <div className="text-xs text-muted-foreground">
                      Arrived: {formatDateTime(record.arrivedAt)}
                      {record.departedAt ? ` · Departed: ${formatDateTime(record.departedAt)}` : ''}
                    </div>
                  ) : null}
                  {companySettings.forceDriverSignature ? (
                    <div className={`rounded-md px-3 py-2 text-xs ${stop.invoice_has_signature ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {stop.invoice_has_signature
                        ? 'Signature captured. Driver can complete this stop.'
                        : 'Signature is required before the driver can move to the next field.'}
                    </div>
                  ) : null}
                  {companySettings.forceDriverProofOfDelivery ? (
                    <div className={`rounded-md px-3 py-2 text-xs ${stop.invoice_has_proof_of_delivery ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {stop.invoice_has_proof_of_delivery
                        ? 'Proof-of-delivery photo uploaded.'
                        : 'A delivery photo is required before the driver can move to the next stop.'}
                    </div>
                  ) : null}
                </div>

                <div className="flex w-full flex-col gap-2 md:w-56">
                  {status === 'pending' ? (
                    <Button disabled={isBusy} onClick={() => onArrive(stop.id)}>
                      <MapPin className="mr-2 h-4 w-4" />
                      {isBusy ? 'Saving...' : 'Arrive'}
                    </Button>
                  ) : null}
                  {status === 'arrived' ? (
                    <>
                      {stop.invoice_id ? (
                        <Button variant="outline" disabled={isBusy} onClick={() => onOpenSignature(stop.id)}>
                          <FileSignature className="mr-2 h-4 w-4" />
                          {stop.invoice_has_signature ? 'View Signature Flow' : 'Capture Signature'}
                        </Button>
                      ) : null}
                      {stop.invoice_id ? (
                        <Button variant="outline" disabled={isBusy} onClick={() => onUploadProofOfDelivery(stop.id)}>
                          <Camera className="mr-2 h-4 w-4" />
                          {stop.invoice_has_proof_of_delivery ? 'Replace Delivery Photo' : 'Upload Delivery Photo'}
                        </Button>
                      ) : null}
                      <Button disabled={isBusy} onClick={() => onDepart(stop.id)}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {isBusy ? 'Saving...' : 'Depart'}
                      </Button>
                    </>
                  ) : null}
                  {status === 'completed' && stop.invoice_id ? (
                    <Button variant="outline" onClick={() => onDownloadInvoice(stop.invoice_id || '')}>
                      <ClipboardList className="mr-2 h-4 w-4" />
                      Open Invoice PDF
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
