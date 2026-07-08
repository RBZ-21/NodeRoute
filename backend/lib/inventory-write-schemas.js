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

// Coerce empty-string → undefined so optional fields behave correctly.
// In Zod v4, z.optional() must wrap the whole z.preprocess() so that absent
// keys short-circuit before the preprocess runs.  '' is handled inside the
// inner union so it also resolves to undefined (stripped from output).
const emptyToUndef = (v) => (v === '' ? undefined : v);

function optionalStr(schema) {
  return z.optional(z.preprocess(emptyToUndef, z.union([z.undefined(), schema])));
}
function optionalNum(schema) {
  return z.optional(z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.union([z.undefined(), schema])
  ));
}

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

// ── Inventory write schemas used by the /inventory routes ─────────────────────

function coerceNum(v) {
  return Number(v);
}

function coerceBool(v) {
  if (v === true  || v === 'yes'  || v === 'true'  || v === '1' || v === 1)  return true;
  if (v === false || v === 'no'   || v === 'false' || v === '0' || v === 0)  return false;
  return v; // pass through so Zod's boolean validator rejects invalid strings
}

const stripUndef = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const inventoryCountBodySchema = z.object({
  notes: z.optional(z.preprocess(
    (v) => { if (typeof v === 'string') { const t = v.trim(); return t === '' ? undefined : t; } return v; },
    z.string().min(1)
  )),
  items: z.array(
    z.object({
      item_number: z.preprocess(
        (v) => String(v ?? '').trim(),
        z.string().min(1, 'item_number is required')
      ),
      counted_qty: z.preprocess(
        (v) => { if (v === '' || v == null) return NaN; return Number(v); },
        z.number().nonnegative('counted_qty must be >= 0')
      ),
    })
  ).min(1, 'at least one item is required'),
});

const inventoryLotPatchBodySchema = z.object({
  qty_on_hand:   z.optional(z.preprocess(coerceNum, z.number().nonnegative())),
  cost_per_unit: z.optional(z.preprocess(coerceNum, z.number().nonnegative())),
  supplier_name: z.optional(z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1)
  )),
  notes: z.optional(z.preprocess(
    (v) => (v === '' ? null : v),
    z.union([z.string(), z.null()])
  )),
}).strict()
  .transform(stripUndef)
  .refine((obj) => Object.keys(obj).length > 0, { message: 'at least one field is required' });

// Treats '' as undefined (field absent) so stripUndef removes it from the output.
const coerceOptionalNum = (v) => (v === '' || v == null ? undefined : Number(v));

const inventoryProductPatchBodySchema = z.object({
  item_number:         z.optional(z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1))),
  description:         z.optional(z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1))),
  description_line_1:  z.optional(z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1))),
  category:            z.optional(z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1))),
  class_name:          z.optional(z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1))),
  unit:                z.optional(z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1))),
  cost:                z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  base_cost:           z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  cost_base:           z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  landed_cost:         z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  lot_cost:            z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  market_cost:         z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  real_cost:           z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  cost_real:           z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  allocated_quantity:  z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().finite()]))),
  on_hand_qty:         z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  on_hand_quantity:    z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().finite()]))),
  on_hand_weight:      z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().finite()]))),
  value_at_cost:       z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().finite()]))),
  value_at_level_1:    z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().finite()]))),
  default_price_per_lb: z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  is_catch_weight:     z.optional(z.preprocess(coerceBool, z.boolean())),
  is_active:           z.optional(z.preprocess(coerceBool, z.boolean())),
  reorder_point:       z.optional(z.preprocess(coerceOptionalNum, z.union([z.undefined(), z.number().nonnegative()]))),
  barcode:             z.optional(z.preprocess((v) => (v === '' ? null : v), z.union([z.string(), z.null(), z.undefined()]))),
  notes: z.optional(z.preprocess(
    (v) => (v === '' || v === null ? null : v),
    z.union([z.string(), z.null()])
  )),
}).strict()
  .transform(stripUndef)
  .refine((obj) => Object.keys(obj).length > 0, { message: 'at least one field is required' });

module.exports = {
  LotPatchSchema,
  inventoryCountBodySchema,
  inventoryLotPatchBodySchema,
  inventoryProductPatchBodySchema,
};
