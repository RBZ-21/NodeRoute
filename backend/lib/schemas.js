'use strict';

const { z } = require('zod');

// ── Reusable primitives ───────────────────────────────────────────────────────

const optStr = (max) => z.string().max(max).optional();
const posNum = z.number({ invalid_type_error: 'must be a number' }).positive();
const optPosNum = posNum.optional();
const nonNegNum = z.number({ invalid_type_error: 'must be a number' }).min(0);

// ── Orders ────────────────────────────────────────────────────────────────────

const orderItem = z.object({}).passthrough();
const orderCharge = z.object({}).passthrough();

const orderCreateSchema = z.object({
  customerName:    z.string({ required_error: 'customerName is required' }).min(1).max(200),
  customerEmail:   optStr(200),
  customerAddress: optStr(500),
  notes:           optStr(2000),
  items:           z.array(orderItem).max(200).optional(),
  charges:         z.array(orderCharge).max(20).optional(),
  taxEnabled:      z.boolean().optional(),
  tax_enabled:     z.boolean().optional(),
  taxRate:         nonNegNum.optional(),
  tax_rate:        nonNegNum.optional(),
}).passthrough();

const orderUpdateSchema = z.object({
  customerName:    optStr(200),
  customerEmail:   optStr(200),
  customerAddress: optStr(500),
  notes:           optStr(2000),
  items:           z.array(orderItem).max(200).optional(),
  charges:         z.array(orderCharge).max(20).optional(),
  status:          z.enum(['pending', 'in_process', 'invoiced', 'cancelled']).optional(),
  driverName:      optStr(200),
  routeId:         optStr(100),
  taxEnabled:      z.boolean().optional(),
  tax_enabled:     z.boolean().optional(),
  taxRate:         nonNegNum.optional(),
  tax_rate:        nonNegNum.optional(),
}).passthrough();

const orderActualWeightSchema = z.object({
  actual_weight: posNum,
}).passthrough();

const orderSendSchema = z.object({
  taxEnabled:  z.boolean().optional(),
  tax_enabled: z.boolean().optional(),
  taxRate:     nonNegNum.optional(),
  tax_rate:    nonNegNum.optional(),
}).passthrough();

const orderFulfillSchema = z.object({
  items:      z.array(orderItem).max(200).optional(),
  driverName: optStr(200),
  routeId:    optStr(100),
}).passthrough();

// ── Invoices ──────────────────────────────────────────────────────────────────

const invoiceItem = z.object({}).passthrough();

const invoiceCreateSchema = z.object({
  customer_name:    optStr(200),
  customerName:     optStr(200),
  customer_email:   optStr(200),
  customerEmail:    optStr(200),
  customer_address: optStr(500),
  customerAddress:  optStr(500),
  deliveryAddress:  optStr(500),
  notes:            optStr(2000),
  items:            z.array(invoiceItem).max(200).optional(),
  subtotal:         nonNegNum.optional(),
  tax:              nonNegNum.optional(),
  total:            nonNegNum.optional(),
  tax_enabled:      z.boolean().optional(),
  taxEnabled:       z.boolean().optional(),
  tax_rate:         nonNegNum.optional(),
  taxRate:          nonNegNum.optional(),
}).passthrough().refine(
  (b) => !!(b.customer_name || b.customerName || b.BillTo),
  { message: 'customer_name is required' }
);

const invoiceImportEntrySchema = z.object({}).passthrough();

const invoiceImportSchema = z.union([
  z.array(invoiceImportEntrySchema).min(1).max(500),
  invoiceImportEntrySchema,
]);

const invoiceSignSchema = z.object({
  signature_data: z.string({ required_error: 'signature_data is required' })
    .min(1)
    .max(5_000_000, 'signature_data exceeds maximum size'),
  signature: z.string().min(1).max(5_000_000).optional(),
}).passthrough();

// ── Inventory ─────────────────────────────────────────────────────────────────

const inventoryCreateSchema = z.object({
  description:     z.string({ required_error: 'description is required' }).min(1).max(300),
  category:        optStr(100),
  item_number:     optStr(100),
  unit:            optStr(50),
  cost:            nonNegNum.optional(),
  on_hand_qty:     nonNegNum.optional(),
  on_hand_weight:  nonNegNum.optional(),
  lot_item:        z.enum(['Y', 'N']).optional(),
  notes:           optStr(1000),
}).passthrough();

const inventoryUpdateSchema = z.object({
  description:           optStr(300),
  category:              optStr(100),
  item_number:           optStr(100),
  unit:                  optStr(50),
  cost:                  nonNegNum.optional(),
  on_hand_qty:           nonNegNum.optional(),
  on_hand_weight:        nonNegNum.optional(),
  lot_item:              z.enum(['Y', 'N']).optional(),
  is_catch_weight:       z.boolean().optional(),
  default_price_per_lb:  nonNegNum.optional(),
  notes:                 optStr(1000),
}).passthrough();

const lotCreateSchema = z.object({
  item_number:       z.string({ required_error: 'item_number is required' }).min(1).max(100),
  lot_number:        z.string({ required_error: 'lot_number is required' }).min(1).max(100),
  batch_number:      optStr(100),
  supplier_name:     optStr(200),
  country_of_origin: optStr(100),
  certifications:    optStr(500),
  storage_temp:      optStr(100),
  received_date:     optStr(20),
  expiry_date:       optStr(20),
  best_before_date:  optStr(20),
  qty_received:      posNum,
  cost_per_unit:     nonNegNum.optional(),
  status:            z.enum(['active', 'quarantine', 'depleted', 'recalled']).optional(),
  notes:             optStr(1000),
}).passthrough();

const lotUpdateSchema = z.object({
  lot_number:        optStr(100),
  batch_number:      optStr(100),
  supplier_name:     optStr(200),
  country_of_origin: optStr(100),
  certifications:    optStr(500),
  storage_temp:      optStr(100),
  received_date:     optStr(20),
  expiry_date:       optStr(20),
  best_before_date:  optStr(20),
  qty_on_hand:       nonNegNum.optional(),
  cost_per_unit:     nonNegNum.optional(),
  status:            z.enum(['active', 'quarantine', 'depleted', 'recalled']).optional(),
  notes:             optStr(1000),
}).passthrough();

const lotDepleteSchema = z.object({
  qty:         posNum,
  change_type: optStr(50),
  notes:       optStr(500),
}).passthrough();

const inventoryCountSchema = z.object({
  items: z.array(z.object({
    item_number: z.string().min(1),
    counted_qty: nonNegNum,
  }).passthrough()).min(1).max(500),
  notes: optStr(500),
}).passthrough();

const inventoryRestockSchema = z.object({
  qty:   posNum,
  notes: optStr(500),
}).passthrough();

const inventoryAdjustSchema = z.object({
  delta:       z.number({ required_error: 'delta is required', invalid_type_error: 'delta must be a number' }),
  change_type: optStr(50),
  notes:       optStr(500),
}).passthrough();

const inventoryPickSchema = z.object({
  qty:          posNum,
  order_id:     optStr(100),
  order_number: optStr(100),
  notes:        optStr(500),
}).passthrough();

const inventorySpoilageSchema = z.object({
  qty:    posNum,
  reason: optStr(500),
  notes:  optStr(500),
}).passthrough();

const inventoryTransferSchema = z.object({
  from_item_number: z.string({ required_error: 'from_item_number is required' }).min(1).max(100),
  to_item_number:   z.string({ required_error: 'to_item_number is required' }).min(1).max(100),
  qty:              posNum,
  notes:            optStr(500),
}).passthrough();

const inventoryYieldSchema = z.object({
  raw_weight:    posNum,
  yield_weight:  posNum,
  notes:         optStr(500),
}).passthrough();

module.exports = {
  // Orders
  orderCreateSchema,
  orderUpdateSchema,
  orderActualWeightSchema,
  orderSendSchema,
  orderFulfillSchema,
  // Invoices
  invoiceCreateSchema,
  invoiceImportSchema,
  invoiceSignSchema,
  // Inventory
  inventoryCreateSchema,
  inventoryUpdateSchema,
  lotCreateSchema,
  lotUpdateSchema,
  lotDepleteSchema,
  inventoryCountSchema,
  inventoryRestockSchema,
  inventoryAdjustSchema,
  inventoryPickSchema,
  inventorySpoilageSchema,
  inventoryTransferSchema,
  inventoryYieldSchema,
};
