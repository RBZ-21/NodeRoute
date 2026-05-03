import { useEffect, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { fetchWithAuth, sendWithAuth } from '../../lib/api';
import { LOCATION_TYPE_LABELS } from './WarehouseTypes';
import type { Location } from './WarehouseTypes';

export function LocationsTab({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'cooler', capacity: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', type: '', capacity: '', notes: '', status: 'active' });
  const [editSaving, setEditSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchWithAuth<Location[]>('/api/warehouse/locations');
      setLocations(data);
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.type) { onError('Name and type are required'); return; }
    setSubmitting(true);
    try {
      const payload: Record<string, any> = { name: form.name, type: form.type, notes: form.notes || undefined };
      if (form.capacity) payload.capacity = parseFloat(form.capacity);
      await sendWithAuth('/api/warehouse/locations', 'POST', payload);
      onNotice(`Location "${form.name}" added.`);
      setShowForm(false);
      setForm({ name: '', type: 'cooler', capacity: '', notes: '' });
      load();
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(id: string | number) {
    setEditSaving(true);
    try {
      const payload: Record<string, any> = { name: editForm.name, type: editForm.type, status: editForm.status, notes: editForm.notes || undefined };
      if (editForm.capacity) payload.capacity = parseFloat(editForm.capacity);
      await sendWithAuth(`/api/warehouse/locations/${id}`, 'PATCH', payload);
      onNotice('Location updated.');
      setEditingId(null);
      load();
    } catch (err) {
      onError(String((err as Error).message));
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {showForm && (
        <Card>
          <CardHeader><CardTitle>Add Location</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={addLocation} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <input required className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" placeholder="e.g. Cooler A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Type *</label>
                <select required className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(LOCATION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Capacity</label>
                <input type="number" className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" placeholder="e.g. 5000 (lbs)" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <input className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Add Location'}</Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Warehouse Locations</CardTitle>
            <CardDescription>Coolers, freezers, depots, and dry storage areas.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>+ Add Location</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.length ? locations.map((loc) => (
                <TableRow key={String(loc.id)}>
                  {editingId === loc.id ? (
                    <>
                      <TableCell><input className="w-28 rounded border border-input bg-background px-2 py-1 text-sm" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></TableCell>
                      <TableCell>
                        <select className="rounded border border-input bg-background px-1 py-1 text-sm" value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                          {Object.entries(LOCATION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </TableCell>
                      <TableCell><input type="number" className="w-20 rounded border border-input bg-background px-2 py-1 text-sm" value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })} /></TableCell>
                      <TableCell>
                        <select className="rounded border border-input bg-background px-1 py-1 text-sm" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                        </select>
                      </TableCell>
                      <TableCell><input className="w-32 rounded border border-input bg-background px-2 py-1 text-sm" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" disabled={editSaving} onClick={() => saveEdit(loc.id)}>{editSaving ? '...' : 'Save'}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{loc.name}</TableCell>
                      <TableCell>{LOCATION_TYPE_LABELS[loc.type] || loc.type}</TableCell>
                      <TableCell>{loc.capacity != null ? `${loc.capacity} lbs` : '-'}</TableCell>
                      <TableCell>
                        <Badge variant={(loc.status === 'active' ? 'success' : 'secondary') as any}>{loc.status || 'active'}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{loc.notes || '-'}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => {
                          setEditingId(loc.id);
                          setEditForm({ name: loc.name, type: loc.type, capacity: String(loc.capacity ?? ''), notes: loc.notes || '', status: loc.status || 'active' });
                        }}>Edit</Button>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No locations configured yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
