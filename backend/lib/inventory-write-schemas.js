'use strict';
/**
 * Zod schemas for inventory write operations.
 *
 * optional*(schema) pattern
 * ─────────────────────────
 * z.preprocess coerces the raw value (e.g. "" → undefined) THEN the outer
 * .optional() makes the key itself optional on PATCH payloads, so omitted
 * keys pass through as-is without triggering validation errors.
 */
const { z } = require('zod');

// Coerce empty-string → undefined so optional fields behave correctly
const emptyToUndef = (v) => (v === '' ? undefined : v);

function optionalStr(schema) {
  return z.preprocess(emptyToUndef, schema.optional());
}
function optionalNum(schema) {
  return z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    schema.optional()
  );
}

const LotCreateSchema = z.object({
  product_name: z.string().min(1),
  lot_number:   z.string().min(1),
  quantity:     z.number().positive(),
  unit:         z.string().min(1),
  location_id:  z.string().uuid().optional(),
  supplier:     z.string().optional(),
  notes:        z.string().optional(),
  expiry_date:  z.string().optional(),
  cost_per_unit: z.number().nonnegative().optional(),
});

const LotPatchSchema = z.object({
  product_name: optionalStr(z.string().min(1)),
  lot_number:   optionalStr(z.string().min(1)),
  quantity:     optionalNum(z.number().nonnegative()),
  unit:         optionalStr(z.string().min(1)),
  location_id:  optionalStr(z.string().uuid()),
  supplier:     optionalStr(z.string()),
  notes:        optionalStr(z.string()),
  expiry_date:  optionalStr(z.string()),
  cost_per_unit: optionalNum(z.number().nonnegative()),
}).strict();

const RestockSchema = z.object({
  lot_id:   z.string().uuid(),
  quantity: z.number().positive(),
  notes:    z.string().optional(),
});

const AdjustSchema = z.object({
  lot_id:   z.string().uuid(),
  quantity: z.number(),
  reason:   z.string().optional(),
});

const PickSchema = z.object({
  lot_id:      z.string().uuid(),
  quantity:    z.number().positive(),
  order_id:    z.string().optional(),
  customer_id: z.string().optional(),
});

const SpoilageSchema = z.object({
  lot_id:   z.string().uuid(),
  quantity: z.number().positive(),
  reason:   z.string().optional(),
});

const TransferSchema = z.object({
  lot_id:          z.string().uuid(),
  quantity:        z.number().positive(),
  to_location_id:  z.string().uuid(),
  from_location_id: z.string().uuid().optional(),
});

const CountSchema = z.object({
  lot_id:    z.string().uuid(),
  quantity:  z.number().nonnegative(),
  notes:     z.string().optional(),
});

const YieldSchema = z.object({
  input_lot_ids:  z.array(z.string().uuid()).min(1),
  output_lots:    z.array(z.object({
    product_name: z.string().min(1),
    lot_number:   z.string().min(1),
    quantity:     z.number().positive(),
    unit:         z.string().min(1),
  })).min(1),
  notes: z.string().optional(),
});

module.exports = {
  LotCreateSchema,
  LotPatchSchema,
  RestockSchema,
  AdjustSchema,
  PickSchema,
  SpoilageSchema,
  TransferSchema,
  CountSchema,
  YieldSchema,
};
