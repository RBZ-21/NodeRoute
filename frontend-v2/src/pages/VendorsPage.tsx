import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

type VendorStatus = 'active' | 'inactive' | 'on-hold' | 'other';

type Vendor = {
  id?: string | number;
  vendorId?: string;
  vendor_id?: string;
  name?: string;
  contact?: string;
  contactName?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  category?: string;
  activePOs?: number | string;
  active_pos?: number | string;
  status?: string;
};

const statusColors = {
  active: 'green',
  inactive: 'gray',
  'on-hold': 'yellow',
} as const;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value: string | undefined): VendorStatus {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (normalized === 'active') return 'active';
  if (normalized === 'inactive') return 'inactive';
  if (normalized === 'on-hold') return 'on-hold';
  return 'other';
}

function vendorId(vendor: Vendor, index: number): string {
  return String(vendor.vendorId || vendor.vendor_id || vendor.id || `VND-${index + 1}`);
}

function vendorName(vendor: Vendor): string {
  return String(vendor.name || '-');
}

function vendorContact(vendor: Vendor): string {
  return String(vendor.contact || vendor.contactName || vendor.contact_name || '-');
}

function activePOs(vendor: Vendor): number {
  return toNumber(vendor.activePOs ?? vendor.active_pos);
}

export function VendorsPage() {
  const navigate = useNavigate();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | VendorStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Vendor[]>('/api/vendors');
      setVendors(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load vendors'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const categoryOptions = useMemo(() => {
    const options = new Set<string>();
    for (const vendor of vendors) {
      const category = String(vendor.category || '').trim();
      if (category) options.add(category);
    }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [vendors]);

  const filtered = useMemo(() => {
    return vendors.filter((vendor) => {
      const status = normalizeStatus(vendor.status);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (categoryFilter !== 'all' && String(vendor.category || '') !== categoryFilter) return false;
      return true;
    });
  }, [vendors, statusFilter, categoryFilter]);

  function viewPOs(vendor: Vendor) {
    const value = vendorName(vendor);
    navigate(`/purchasing?vendor=${encodeURIComponent(value)}`);
  }

  function newPO(vendor: Vendor) {
    const value = vendorName(vendor);
    navigate(`/purchasing?vendor=${encodeURIComponent(value)}`);
    setNotice(`Opened new PO flow for ${value}.`);
  }

  function editVendor(vendor: Vendor, index: number) {
    setNotice(`Vendor editor opened for ${vendorName(vendor)} (${vendorId(vendor, index)}).`);
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading vendors...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Vendors</CardTitle>
            <CardDescription>Supplier roster and PO activity from `/api/vendors`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | VendorStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="on-hold">On Hold</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Active POs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((vendor, index) => {
                  const status = normalizeStatus(vendor.status);
                  return (
                    <TableRow key={vendorId(vendor, index)}>
                      <TableCell className="font-medium">{vendorId(vendor, index)}</TableCell>
                      <TableCell>{vendorName(vendor)}</TableCell>
                      <TableCell>{vendorContact(vendor)}</TableCell>
                      <TableCell>{vendor.email || '-'}</TableCell>
                      <TableCell>{vendor.phone || '-'}</TableCell>
                      <TableCell>{vendor.category || '-'}</TableCell>
                      <TableCell>{activePOs(vendor).toLocaleString()}</TableCell>
                      <TableCell>
                        <StatusBadge status={status} colorMap={statusColors} fallbackLabel="Unknown" />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" size="sm" onClick={() => viewPOs(vendor)}>
                            View POs
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => newPO(vendor)}>
                            New PO
                          </Button>
                          <Button size="sm" onClick={() => editVendor(vendor, index)}>
                            Edit Vendor
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    No vendors found for the selected filters.
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
