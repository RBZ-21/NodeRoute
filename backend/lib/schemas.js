'use strict';

const { z } = require('zod');

// ── Reusable primitives ───────────────────────────────────────────────────────

const optStr = (max) => z.string().max(max).nullable().optional();
const posNum = z.number({ invalid_type_error: 'must be a number' }).positive();
const nonNegNum = z.number({ invalid_type_error: 'must be a number' }).min(0);

// ── Orders ────────────────────────────────────────────────────────────────────

const orderItem = z.object({}).passthrough();
const orderCharge = z.object({}).passthrough();

const orderCreateSchema = z.object({
  customerName:    z.string({ required_error: 'customerName is required' }).min(1).max(200),
  customerEmail:   optStr(200),
  customerPhone:   optStr(50),
  customer_phone:  optStr(50),
  customerAddress: optStr(500),
  routeId:         optStr(100),
  route_id:        optStr(100),
  stop_id:         optStr(100),
  stopId:          optStr(100),
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
  customerPhone:   optStr(50),
  customer_phone:  optStr(50),
  customerAddress: optStr(500),
  route_id:        optStr(100),
  stop_id:         optStr(100),
  stopId:          optStr(100),
  notes:           optStr(2000),
  items:           z.array(orderItem).max(200).optional(),
  charges:         z.array(orderCharge).max(20).optional(),
  status:          z.enum(['pending', 'in_process', 'delivered', 'invoiced', 'cancelled']).optional(),
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

module.exports = {
  // Orders
  orderCreateSchema,
  orderUpdateSchema,
  orderActualWeightSchema,
  orderSendSchema,
  orderFulfillSchema,
  // Invoices
  invoiceImportSchema,
  invoiceSignSchema,
};
