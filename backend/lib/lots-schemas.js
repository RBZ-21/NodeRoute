const { z } = require('zod');

const coercedBoolean = z.union([
  z.boolean(),
  z.string().trim().toLowerCase().transform((v, ctx) => {
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
    ctx.addIssue({ code: 'custom', message: 'Invalid boolean value' });
    return z.NEVER;
  }),
]);

const lotCreateBodySchema = z.object({
  lot_number:        z.string().trim().min(1, 'lot_number is required'),
  product_id:        z.string().trim().optional(),
  vendor_id:         z.string().trim().optional(),
  quantity_received: z.union([
    z.number().finite().nonnegative(),
    z.string().trim().min(1).pipe(z.coerce.number().finite().nonnegative()),
  ]).optional(),
  unit_of_measure:   z.string().trim().optional(),
  received_date:     z.string().trim().optional(),
  expiration_date:   z.string().trim().optional(),
  notes:             z.string().trim().optional(),
}).strict();

const lotFtlPatchBodySchema = z.object({
  is_ftl_product: coercedBoolean,
}).strict();

module.exports = { lotCreateBodySchema, lotFtlPatchBodySchema };
