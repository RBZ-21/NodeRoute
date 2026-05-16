const { z } = require('zod');

const clampedInt = (min, max, defaultVal) =>
  z.coerce.number().finite()
    .transform((v) => Math.max(min, Math.min(max, Math.trunc(v))))
    .default(defaultVal);

const poDraftFromSuggestionsBodySchema = z.object({
  coverageDays:      clampedInt(1, 90, 30),
  leadTimeDays:      clampedInt(0, 60, 5),
  lookbackDays:      clampedInt(7, 90, 30),
  minOrderQty:       z.coerce.number().finite().nonnegative().default(0),
  maxLines:          clampedInt(1, 200, 50),
  vendor:            z.string().trim().default('Unassigned Vendor'),
  notes:             z.string().trim().default(''),
  includeUrgencies:  z.preprocess(
    (v) => (Array.isArray(v) && v.length ? v.map((s) => String(s).toLowerCase()) : undefined),
    z.array(z.enum(['high', 'normal', 'none'])).default(['high', 'normal'])
  ),
}).strict();

const intakeItemSchema = z.object({
  name:         z.string().optional(),
  product_name: z.string().optional(),
  item_number:  z.string().optional(),
  product_id:   z.string().optional(),
  unit:         z.string().optional(),
}).passthrough();

const poDraftFromOrderIntakeBodySchema = z.object({
  intakeItems:   z.array(intakeItemSchema).min(1, 'intakeItems is required'),
  leadTimeDays:  clampedInt(0, 60, 5),
  lookbackDays:  clampedInt(7, 90, 30),
  minOrderQty:   z.coerce.number().finite().nonnegative().default(0),
  maxLines:      clampedInt(1, 200, 50),
  vendor:        z.string().trim().default('Unassigned Vendor'),
  notes:         z.string().trim().default(''),
  intakeMessage: z.string().trim().optional(),
}).strict();

const poDraftStatusPatchBodySchema = z.object({
  status: z.enum(['draft', 'ready', 'ordered', 'archived'], {
    errorMap: () => ({ message: 'Invalid status' }),
  }),
}).strict();

module.exports = {
  poDraftFromSuggestionsBodySchema,
  poDraftFromOrderIntakeBodySchema,
  poDraftStatusPatchBodySchema,
};
