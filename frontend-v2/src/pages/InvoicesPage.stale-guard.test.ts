// FE-003 regression test (Root Depth Scan, commit 904d7119).
// Original bug: the AI follow-up draft mutation callbacks in InvoicesPage
// applied their resolution (setFollowUpDraft / setFollowUpInvoiceId) without
// checking whether the resolving invoice still matched the current selection
// — the same stale-resolution pattern as FE-002, so the same guard applies.
//
// InvoicesPage requires substantial API scaffolding to mount, so this locks
// the guard in at source level; the guard's runtime behavior is covered by
// the FE-002 component test of the identical pattern.

import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, 'InvoicesPage.tsx'), 'utf8');

describe('InvoicesPage stale AI-draft guard (FE-003)', () => {
  it('tracks the current selection in a ref', () => {
    expect(source).toMatch(/selectedInvoiceIdRef = useRef<string \| null>\(null\)/);
    expect(source).toMatch(/selectedInvoiceIdRef\.current = selected \? String\(selected\.id \|\| ''\) : null/);
  });

  it('guards BOTH follow-up mutation call sites, success and error paths', () => {
    const successGuards = source.match(/if \(selectedInvoiceIdRef\.current !== (selectedId|id)\) return;/g) || [];
    // 2 call sites x (onSuccess + onError) = 4 guards.
    expect(successGuards.length).toBe(4);
  });

  it('never applies a draft without a guard preceding it', () => {
    // Every setFollowUpDraft(result) must appear after a stale-check.
    const applySites = [...source.matchAll(/setFollowUpDraft\(result\)/g)];
    expect(applySites.length).toBeGreaterThan(0);
    for (const match of applySites) {
      const preceding = source.slice(Math.max(0, match.index! - 250), match.index!);
      expect(preceding).toMatch(/selectedInvoiceIdRef\.current !== (selectedId|id)\) return;/);
    }
  });
});
