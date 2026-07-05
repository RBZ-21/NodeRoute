import { describe, expect, it } from 'vitest';
import type { BillingCatalogResponse } from './superadmin/billing-types';

describe('Superadmin billing types', () => {
  it('supports workbook tier and add-on codes', () => {
    const catalog: BillingCatalogResponse = {
      tiers: [{ code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 }],
      features: [],
      featureMatrix: [],
      limits: [],
      addons: [{ code: 'ai_phone_orders', name: 'AI Phone Orders', base_monthly_cents: 49900, default_setup_cents: null, usage_terms: '$0.20 per connected minute', eligible_tier_codes: ['track'], quote_only: false, display_order: 10 }],
    };
    expect(catalog.tiers[0].code).toBe('track');
    expect(catalog.addons[0].code).toBe('ai_phone_orders');
  });
});
