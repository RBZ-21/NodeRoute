# Multi-photo PO scanning — design

**Date:** 2026-06-30
**Status:** Approved, ready for implementation plan

## Problem

The AI PO scan feature accepts exactly one image per scan. A purchase order /
dock invoice that spans more than one page cannot be captured in a single scan,
so line items on page 2+ are lost or require a separate, disconnected scan.

## Goal

Let a user attach multiple photos (pages) of a single PO and scan them together,
producing one merged result (vendor, PO#, and total read once; line items
concatenated across pages).

## Decisions

| Decision | Choice |
| --- | --- |
| Processing | One combined vision call across all pages (model merges items) |
| Screens | Both Create PO (`CreatePurchaseOrderForm`) and Receive PO (`ReceivePoDrawer`) |
| Page cap | Max 5 pages per scan |
| Add-pages UX | Staged thumbnail list; user adds/removes pages, then presses "Scan N pages" |
| DB schema | No change — one `po_invoice_scans` row per scan, as today |

## Current flow (single image)

1. **Frontend** — `CreatePurchaseOrderForm.tsx` / `ReceivePoDrawer.tsx` render a
   hidden file input + camera input; `onChange` immediately calls
   `scanPoFile(file)`.
2. **API** — `scanPoFile` (`usePurchasing.ts:302`) → `uploadWithAuth('/api/ai/scan-po', 'image', file)`
   posts one file as multipart field `image`.
3. **Route** — `/scan-po` (`ai.js:506`) uses
   `upload.fields([{ file, maxCount:1 }, { image, maxCount:1 }])`, picks the one
   file, base64-encodes it, calls `parsePurchaseOrderImage(base64, mimeType)`,
   then `recordPoInvoiceScan(...)`.
4. **Vision** — `parsePurchaseOrderImage` (`ai.js:1261`) sends one `text` block +
   one `image_url` block to `DEFAULT_VISION_MODEL`, normalizes the JSON result.

## Target design

### 1. Vision service — `parsePurchaseOrderImage` (`backend/services/ai.js`)

- New signature accepts an **array** of `{ base64, mimeType }`. For backward
  compatibility it also tolerates a single `(base64String, mimeType)` call so the
  existing caller in `backend/routes/purchase-orders.js:182` keeps working —
  normalize the input to an array internally.
- Build one `content` array: the prompt `text` block followed by one `image_url`
  block per page (preserving order).
- Prompt gets one added sentence: the images are sequential pages of a single
  document; merge line items across pages and do not double-count headers/totals.
- Result normalization (`normalizePOScan`) is unchanged — still one merged result.

### 2. Scan route — `/scan-po` (`backend/routes/ai.js`)

- Multer: `upload.fields([{ name:'file', maxCount:5 }, { name:'image', maxCount:5 }])`.
- Collect `req.files.file` + `req.files.image` into one ordered list.
- Validation: at least one file; reject if total > 5 with a clear message; apply
  the existing per-file type allow-list (`jpeg/png/webp/pdf`) and the existing
  10 MB per-file limit to every file.
- Base64-encode each file; pass the `{ base64, mimeType }[]` array to
  `parsePurchaseOrderImage`.
- `recordPoInvoiceScan`: store the page count and a joined filename list (e.g.
  comma-separated `originalname`s) so the audit record reflects all pages.

### 3. Frontend API (`frontend-v2/src/hooks/usePurchasing.ts`, `lib/api.ts`)

- Add `uploadFilesWithAuth<T>(url, field, files: File[])` mirroring
  `uploadWithAuth` but appending each file under the same field name.
- Add `scanPoFiles(files: File[]): Promise<PoScanResult>` →
  `uploadFilesWithAuth('/api/ai/scan-po', 'image', files)`.
- Keep `scanPoFile` (single) for any remaining callers; both PO scan call sites
  switch to `scanPoFiles`.

### 4. Shared uploader component — `PoScanUploader`

A small component with one job: stage pages and emit `File[]` on scan. Reused by
both screens to avoid duplicating staging logic.

- Props: `onScan(files: File[])`, `loading: boolean`, optional `maxPages = 5`,
  and labels/description for the card so each screen can keep its own copy.
- State: `pages: File[]`.
- "📁 Upload Image" — file picker with `multiple`; **appends** selected images.
- "📷 Take Photo" — camera capture (one shot); **appends** the photo.
- Thumbnail strip: object-URL preview per page, page index, per-page remove (✕);
  revoke object URLs on removal/unmount.
- Enforces `maxPages`; shows a friendly message when the cap is reached and
  ignores extra files beyond the cap.
- Primary button: "Scan N page(s)", disabled when empty or `loading`; calls
  `onScan(pages)`.
- Loading and error display remain owned by the parent screens (unchanged).

### 5. Screen wiring

- `CreatePurchaseOrderForm.tsx`: replace the inline file/camera inputs + buttons
  with `<PoScanUploader>`; change `handleScanFile(file)` → `handleScanFiles(files)`
  calling `scanPoFiles(files)`.
- `ReceivePoDrawer.tsx`: same swap; `handleReceiveScanFile(file)` →
  `handleReceiveScanFiles(files)` calling `scanPoFiles(files)`. Existing
  `applyReceiveScanResult` / notice logic is unchanged (still one merged result).

## Testing

- **Service** (`backend/tests/...ai...`): `parsePurchaseOrderImage` with an array
  builds N `image_url` blocks; single-arg legacy call still builds one block.
- **Route** (`backend/tests/ai-scan-po-route.test.js`): multi-file upload merges
  items into one result; >5 files rejected; single-file upload still works;
  invalid type among the set rejected.
- **Frontend**: `PoScanUploader` stages multiple files, removes a page, and emits
  the array; cap message appears at the limit. Existing
  `CreatePurchaseOrderForm` / receiving tests updated for the new handler shape.

## Out of scope

- No change to `po_invoice_scans` schema or to how a confirmed PO stores items.
- No persistent storage of the page images beyond the existing scan record
  behavior.
- No client-side image stitching/PDF generation — each page is sent as-is.
