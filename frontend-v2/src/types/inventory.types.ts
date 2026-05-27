export type InventoryItem = {
  id: string;
  item_number?: string;
  description?: string;
  name?: string;
  category?: string;
  on_hand_qty?: number | string;
  cost?: number | string;
  unit?: string;
  is_ftl_product?: boolean;
  is_catch_weight?: boolean;
  is_active?: boolean;
  default_price_per_lb?: number | string;
  reorder_point?: number | string | null;
  barcode?: string | null;
  location_id?: string | null;
  company_id?: string | null;
};

export type LowStockItem = InventoryItem & {
  deficit: number;
};

export type InventoryLotSummary = {
  id: string;
  lot_number: string;
  product_id?: string;
  vendor_id?: string;
  quantity_received?: number | string;
  unit_of_measure?: string;
  received_date?: string;
  expiration_date?: string;
  notes?: string;
  created_at?: string;
};

export type CountSheetRow = {
  id: string;
  item_number: string;
  description: string;
  category: string;
  on_hand_qty: number;
  unit: string;
};

export type LedgerSummary = {
  count: number;
  total_delta: number;
  inbound_qty: number;
  outbound_qty: number;
};

export type LedgerEntry = {
  item_number?: string;
  change_qty?: number | string;
  new_qty?: number | string;
  change_type?: string;
  notes?: string;
  created_by?: string;
  created_at?: string;
};

export type LedgerResponse = {
  summary?: LedgerSummary;
  entries?: LedgerEntry[];
};

export type RecentSoldItemsResponse = {
  item_count?: number;
  items?: Array<{
    key: string;
    item_number?: string | null;
    label?: string | null;
    invoice_count?: number;
    qty?: number;
  }>;
};
