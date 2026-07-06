// FE-002 regression tests (Root Depth Scan, commit 904d7119).
// Original bug: the PO-receipt mutation's onSuccess wrote its resolution into
// parent state (onPosted -> setActiveReceivePo) without checking whether the
// resolving PO still matched the current selection — a slow receipt for a
// previously selected PO could overwrite the user's current selection and
// drawer state.

import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { ReceivePoDrawer } from './ReceivePoDrawer';
import type { VendorPurchaseOrder } from '../hooks/usePurchasing';

type MutateOpts = { onSuccess?: (po: VendorPurchaseOrder) => void; onError?: (e: Error) => void };
const mutateMock = vi.fn<(vars: unknown, opts: MutateOpts) => void>();

vi.mock('../hooks/usePurchasing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/usePurchasing')>();
  return {
    ...actual,
    useReceiveVendorPurchaseOrder: () => ({ mutate: mutateMock, isPending: false }),
    scanPoFiles: vi.fn(),
  };
});

function makePo(id: string, poNumber: string): VendorPurchaseOrder {
  return {
    id,
    po_number: poNumber,
    status: 'open',
    vendor: 'Test Vendor',
    lines: [
      {
        line_no: 1,
        item_number: 'SKU-1',
        product_name: 'Salmon',
        qty_ordered: 10,
        qty_received: 0,
        unit_cost: 2,
      },
    ],
  } as unknown as VendorPurchaseOrder;
}

function renderDrawer(po: VendorPurchaseOrder) {
  const onPosted = vi.fn();
  const setNotice = vi.fn();
  const setFormError = vi.fn();
  render(
    <ReceivePoDrawer
      po={po}
      onPosted={onPosted}
      onClose={() => {}}
      setNotice={setNotice}
      setFormError={setFormError}
    />
  );
  return { onPosted, setNotice, setFormError };
}

function enterQtyAndSubmit() {
  // First numeric input in the receive grid is the qty-received field
  // (placeholder "0.00" per the drawer markup).
  const qty = document.querySelector('input[type="number"][placeholder="0.00"]') as HTMLInputElement;
  if (!qty) throw new Error('qty-received input not found');
  fireEvent.change(qty, { target: { value: '5' } });
  const postButton = screen.getAllByRole('button').find((b) => /post receipt/i.test(b.textContent || ''));
  if (!postButton) throw new Error('post receipt button not found');
  fireEvent.click(postButton);
}

describe('ReceivePoDrawer stale-resolution guard (FE-002)', () => {
  beforeEach(() => mutateMock.mockReset());

  it('applies the resolution when it matches the drawer PO', () => {
    const po = makePo('po-a', 'PO-A');
    const { onPosted } = renderDrawer(po);
    enterQtyAndSubmit();

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const opts = mutateMock.mock.calls[0][1];
    act(() => opts.onSuccess?.({ ...po, receipts: [] } as VendorPurchaseOrder));

    expect(onPosted).toHaveBeenCalledTimes(1);
    expect((onPosted.mock.calls[0][0] as VendorPurchaseOrder).id).toBe('po-a');
  });

  it('IGNORES a resolution for a different PO id (the original bug)', () => {
    const po = makePo('po-a', 'PO-A');
    const { onPosted, setNotice } = renderDrawer(po);
    enterQtyAndSubmit();

    const opts = mutateMock.mock.calls[0][1];
    const stale = makePo('po-b', 'PO-B');
    act(() => opts.onSuccess?.({ ...stale, receipts: [] } as VendorPurchaseOrder));

    expect(onPosted).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
  });
});

describe('PurchasingPage selection guard (FE-002)', () => {
  it('onPosted only replaces the selection when ids match', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'PurchasingPage.tsx'), 'utf8');
    // The parent must use a guarded functional update, not raw setActiveReceivePo.
    expect(source).not.toMatch(/onPosted=\{setActiveReceivePo\}/);
    expect(source).toMatch(/current && current\.id === updatedPo\.id \? updatedPo : current/);
  });
});
