// FE-006 regression test (Root Depth Scan, commit 904d7119).
// Original bug: async portal payment/contact handlers resolved after unmount
// and still called React state setters.

import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, 'usePortalData.ts'), 'utf8');

function functionSource(name: string) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n  async function ', start + 1);
  const fallback = source.indexOf('\n  const paymentBalance', start + 1);
  const end = next === -1 ? fallback : Math.min(next, fallback === -1 ? next : fallback);
  return source.slice(start, end);
}

describe('usePortalData unmount guard (FE-006)', () => {
  it('tracks mounted state in a ref and clears it on unmount', () => {
    expect(source).toMatch(/isMountedRef = useRef\(true\)/);
    expect(source).toMatch(/isMountedRef\.current = true/);
    expect(source).toMatch(/isMountedRef\.current = false/);
  });

  it('drops post-await continuations in the portal async handlers', () => {
    for (const name of ['startCheckout', 'runAutopayNow', 'saveContact']) {
      expect(functionSource(name)).toMatch(/if \(!isMountedRef\.current\) return;/);
    }
  });

  it('guards busy-state resets after async handlers settle', () => {
    expect(functionSource('runAutopayNow')).toMatch(/if \(isMountedRef\.current\) setPaymentBusy\(false\)/);
    expect(functionSource('saveContact')).toMatch(/if \(isMountedRef\.current\) setContactBusy\(false\)/);
  });
});
