export type InventoryItem = {
  id: string | number;
  item_number?: string;
  description?: string;
  name?: string;
  on_hand_qty?: number | null;
  quantity?: number | null;
  unit?: string;
  category?: string;
  status?: string;
  location?: string;
  cost?: number | null;
};

export type Location = {
  id: string | number;
  name: string;
  type: string;
  capacity?: number | null;
  notes?: string | null;
  status?: string;
};

export type ScanEvent = {
  id: string | number;
  item_number: string;
  action: string;
  quantity?: number | null;
  unit?: string | null;
  location_id?: string | null;
  lot_number?: string | null;
  notes?: string | null;
  performed_by?: string | null;
  created_at: string;
};

export type ReturnRecord = {
  id: string | number;
  customer_name?: string | null;
  item_number: string;
  item_description?: string | null;
  quantity: number;
  unit?: string | null;
  reason: string;
  lot_number?: string | null;
  notes?: string | null;
  status: string;
  resolution?: string | null;
  restocked?: boolean | null;
  created_at: string;
};

export type WarehouseSummary = {
  inventory: InventoryItem[];
  pendingInbound: number;
  todayStops: number;
  todayStopsCompleted: number;
  todayScans: number;
  openReturns: number;
};

export const ACTION_COLORS: Record<string, string> = {
  receive: 'success',
  pick: 'warning',
  adjust: 'secondary',
  scan: 'secondary',
  transfer: 'default',
};

export const RETURN_STATUS_COLORS: Record<string, string> = {
  open: 'warning',
  resolved: 'success',
  restocked: 'success',
  discarded: 'destructive',
};

export const LOCATION_TYPE_LABELS: Record<string, string> = {
  cooler: '❄️ Cooler',
  freezer: '🧊 Freezer',
  depot: '📦 Depot',
  dry: '🌾 Dry Storage',
  other: '🏭 Other',
};
