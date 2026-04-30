const { z } = require('zod');

const blankToUndefined = z.union([
  z.literal('').transform(() => undefined),
  z.null().transform(() => undefined),
  z.undefined(),
]);

const optionalTrimmedString = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  return String(value).trim();
}, z.string().optional());

const optionalNullableString = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}, z.string().nullable().optional());

const optionalCoercedNumber = z.union([
  z.number().finite(),
  z.string().trim().min(1).pipe(z.coerce.number().finite()),
  blankToUndefined,
]).optional();

const optionalCoercedBoolean = z.union([
  z.boolean(),
  z.string().trim().toLowerCase().transform((value, ctx) => {
    if (['true', '1', 'yes', 'on'].includes(value)) return true;
    if (['false', '0', 'no', 'off'].includes(value)) return false;
    ctx.addIssue({ code: 'custom', message: 'Invalid boolean value' });
    return z.NEVER;
  }),
  blankToUndefined,
]).optional();

const countedQuantity = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') return Number.NaN;
  return value;
}, z.coerce.number().finite().nonnegative());

function stripUndefinedFields(body) {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined)
  );
}

const nonEmptyPatch = schema => schema
  .transform(stripUndefinedFields)
  .refine(
    body => Object.keys(body).length > 0,
    { message: 'At least one field is required' }
  );

const inventoryCountBodySchema = z.object({
  notes: optionalTrimmedString,
  items: z.array(z.object({
    item_number: z.coerce.string().trim().min(1),
    counted_qty: countedQuantity,
  }).strict()).min(1),
}).strict();

const inventoryLotPatchBodySchema = nonEmptyPatch(z.object({
  lot_number: optionalTrimmedString,
  batch_number: optionalNullableString,
  supplier_name: optionalNullableString,
  country_of_origin: optionalNullableString,
  certifications: optionalNullableString,
  storage_temp: optionalNullableString,
  received_date: optionalNullableString,
  expiry_date: optionalNullableString,
  best_before_date: optionalNullableString,
  qty_on_hand: optionalCoercedNumber,
  cost_per_unit: optionalCoercedNumber,
  status: optionalTrimmedString,
  notes: optionalNullableString,
}).strict());

const inventoryProductPatchBodySchema = nonEmptyPatch(z.object({
  description: optionalTrimmedString,
  category: optionalTrimmedString,
  item_number: optionalTrimmedString,
  unit: optionalTrimmedString,
  cost: optionalCoercedNumber,
  on_hand_qty: optionalCoercedNumber,
  on_hand_weight: optionalCoercedNumber,
  lot_item: optionalTrimmedString,
  notes: optionalNullableString,
  is_catch_weight: optionalCoercedBoolean,
  default_price_per_lb: optionalCoercedNumber,
}).strict());

module.exports = {
  inventoryCountBodySchema,
  inventoryLotPatchBodySchema,
  inventoryProductPatchBodySchema,
};
