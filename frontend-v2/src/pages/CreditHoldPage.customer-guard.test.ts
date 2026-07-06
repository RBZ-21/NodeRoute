// FE-007 regression test (Root Depth Scan, commit 904d7119).
// Original bug: doAction used customer!.customer_id after an async mutation.

import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, 'CreditHoldPage.tsx'), 'utf8');

describe('CreditHoldPage customer guard (FE-007)', () => {
  it('does not use a non-null customer assertion', () => {
    expect(source).not.toContain('customer!');
  });

  it('guards credit actions before using the selected customer id', () => {
    const start = source.indexOf('async function doAction');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('\n  async function doSettings', start);
    const doAction = source.slice(start, end);

    expect(doAction).toMatch(/const activeCustomer = customer/);
    expect(doAction).toMatch(/if \(!activeCustomer\)/);
    expect(doAction).toMatch(/activeCustomer\.customer_id/);
  });
});
