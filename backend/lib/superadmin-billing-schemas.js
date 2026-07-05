'use strict';

const { z } = require('zod');

const tierCodeSchema = z.enum(['track', 'dispatch', 'operations', 'erp', 'enterprise']);
const billingStatusSchema = z.enum(['trial', 'active', 'paused', 'cancelled']);
const billingIntervalSchema = z.enum(['monthly', 'annual']);
const inclusionSchema = z.enum([
  'no', 'yes', 'basic', 'full', 'limited', 'add_on',
  'included_fair_use', 'discounted_add_on', 'custom', 'assisted_migration',
]);

const centsSchema = z.number().int().min(0).nullable();

const featureOverrideSchema = z.object({
  feature_code: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  inclusion: inclusionSchema,
  notes: z.string().max(2000).default(''),
}).strict();

const addonSchema = z.object({
  addon_code: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  quantity: z.number().min(0).default(1),
  monthly_price_cents: centsSchema,
  setup_price_cents: centsSchema,
  usage_terms: z.string().max(1000).default(''),
  notes: z.string().max(2000).default(''),
}).strict();

const saveCompanyBillingSchema = z.object({
  plan_tier_code: tierCodeSchema,
  billing_status: billingStatusSchema,
  billing_interval: billingIntervalSchema,
  custom_pricing_enabled: z.boolean(),
  custom_monthly_price_cents: centsSchema,
  custom_setup_price_cents: centsSchema,
  annual_discount_bps: z.number().int().min(0).max(5000).default(0),
  contract_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  contract_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  pricing_notes: z.string().max(4000).default(''),
  feature_overrides: z.array(featureOverrideSchema).default([]),
  addons: z.array(addonSchema).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.contract_start_date && value.contract_end_date && value.contract_end_date < value.contract_start_date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contract_end_date'], message: 'contract_end_date must be on or after contract_start_date' });
  }
  if (value.custom_pricing_enabled && value.custom_monthly_price_cents === null && value.custom_setup_price_cents === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['custom_pricing_enabled'], message: 'custom pricing requires a monthly or setup override' });
  }
});

function parseSaveCompanyBilling(input) {
  return saveCompanyBillingSchema.parse(input);
}

module.exports = {
  parseSaveCompanyBilling,
  saveCompanyBillingSchema,
  tierCodeSchema,
  inclusionSchema,
};
