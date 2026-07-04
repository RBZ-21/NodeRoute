// GENERATED FILE — do not edit by hand.
// Source: backend/lib/schemas.js (orderCreateSchema, orderUpdateSchema)
// Regenerate with: npm run codegen:types

export type GeneratedOrderCreateInput = {
    customerName: string;
    customerEmail?: (string | null) | undefined;
    customerPhone?: (string | null) | undefined;
    customer_phone?: (string | null) | undefined;
    customerAddress?: (string | null) | undefined;
    routeId?: (string | null) | undefined;
    route_id?: (string | null) | undefined;
    stop_id?: (string | null) | undefined;
    stopId?: (string | null) | undefined;
    notes?: (string | null) | undefined;
    items?: {
        [x: string]: unknown;
    }[] | undefined;
    charges?: {
        [x: string]: unknown;
    }[] | undefined;
    taxEnabled?: boolean | undefined;
    tax_enabled?: boolean | undefined;
    taxRate?: number | undefined;
    tax_rate?: number | undefined;
    [x: string]: unknown;
};

export type GeneratedOrderUpdateInput = {
    customerName?: (string | null) | undefined;
    customerEmail?: (string | null) | undefined;
    customerPhone?: (string | null) | undefined;
    customer_phone?: (string | null) | undefined;
    customerAddress?: (string | null) | undefined;
    route_id?: (string | null) | undefined;
    stop_id?: (string | null) | undefined;
    stopId?: (string | null) | undefined;
    notes?: (string | null) | undefined;
    items?: {
        [x: string]: unknown;
    }[] | undefined;
    charges?: {
        [x: string]: unknown;
    }[] | undefined;
    status?: ("pending" | "in_process" | "delivered" | "invoiced" | "cancelled") | undefined;
    driverName?: (string | null) | undefined;
    routeId?: (string | null) | undefined;
    taxEnabled?: boolean | undefined;
    tax_enabled?: boolean | undefined;
    taxRate?: number | undefined;
    tax_rate?: number | undefined;
    [x: string]: unknown;
};
