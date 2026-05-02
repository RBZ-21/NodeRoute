export type InventoryItem = {
  id: string;
  item_number?: string;
  description?: string;
  category?: string;
  on_hand_qty?: number | string;
  cost?: number | string;
  unit?: string;
  is_ftl_product?: boolean;
  is_catch_weight?: boolean;
  default_price_per_lb?: number | string;
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
