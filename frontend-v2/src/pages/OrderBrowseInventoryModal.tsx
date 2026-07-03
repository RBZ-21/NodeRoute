import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Modal } from '../components/ui/overlay-panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { asMoney, asNumber, normalizeText, productSelectionKey } from './orders.types';
import type { InventoryProduct } from './orders.types';

export function OrderBrowseInventoryModal({
  lineIndex,
  browsableProducts,
  browseSearch,
  setBrowseSearch,
  onClose,
  onSelectProduct,
}: {
  lineIndex: number;
  browsableProducts: InventoryProduct[];
  browseSearch: string;
  setBrowseSearch: (value: string) => void;
  onClose: () => void;
  onSelectProduct: (lineIndex: number, product: InventoryProduct) => void;
}) {
  return (
    <Modal
      open
      title="Browse Inventory"
      description={`Choose a product for line ${lineIndex + 1}. Out-of-stock items stay selectable so the order can be built before the truck arrives.`}
      onClose={onClose}
      widthClassName="max-w-5xl"
      contentClassName="max-h-[70vh] overflow-auto px-5 py-4"
      actions={
        <Input value={browseSearch} onChange={(e) => setBrowseSearch(e.target.value)} placeholder="Search item #, description, or unit" className="w-72" />
      }
    >
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>On Hand</TableHead>
              <TableHead>Default Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Select</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {browsableProducts.length ? browsableProducts.map((product) => {
              const onHand = asNumber(product.on_hand_qty);
              const statusLabel = onHand <= 0 ? 'Out of stock' : onHand <= 10 ? 'Low stock' : 'In stock';
              const statusClassName = onHand <= 0
                ? 'text-amber-700'
                : onHand <= 10
                  ? 'text-orange-700'
                  : 'text-emerald-700';
              return (
                <TableRow key={productSelectionKey(product)}>
                  <TableCell className="font-mono text-xs">{normalizeText(product.item_number) || '—'}</TableCell>
                  <TableCell className="font-medium">{product.description}</TableCell>
                  <TableCell>{product.unit || '-'}</TableCell>
                  <TableCell>{onHand.toLocaleString()}</TableCell>
                  <TableCell>{asNumber(product.cost) > 0 ? asMoney(asNumber(product.cost)) : '-'}</TableCell>
                  <TableCell className={statusClassName}>{statusLabel}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" size="sm" onClick={() => onSelectProduct(lineIndex, product)}>
                      Use Item
                    </Button>
                  </TableCell>
                </TableRow>
              );
            }) : (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">
                  No inventory items matched that search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Modal>
  );
}
