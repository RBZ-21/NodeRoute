# NodeRoute Invoice Email Layout Design

## Goal

Every invoice emailed by NodeRoute must attach a complete, organized customer invoice modeled on the supplied Crosby's Seafood form. The email body must remain concise and show only the ordered items and invoice total.

## Approved Experience

- Company invoice identity is editable per company in Settings.
- The attached PDF contains seller details, remit-to details, sold-to and shipped-to blocks, invoice metadata, ordered and shipped quantities, UOM, item description, lot number, unit price, extension, number of pieces, signature, subtotal, tax, invoice total, sales terms, credit terms, customer-copy label, and seafood safety notice.
- The email body contains the business name, invoice number, ordered items, quantities, line totals, and invoice total. It does not repeat lot, route, signature, remit-to, or legal details.
- The approved visual direction is a clean digital interpretation of the reference form: strong black metadata bands, restrained NodeRoute orange accents, compact tabular hierarchy, and a legal/footer section that stays readable.

## Architecture

### Editable company settings

Existing `companies.settings` JSONB stores these tenant-scoped values:

- `invoice_address`
- `invoice_phone`
- `invoice_fax`
- `invoice_after_hours_phone`
- `invoice_remit_to`
- `invoice_sales_terms`
- `invoice_credit_terms`
- `invoice_copy_label`
- `invoice_safety_notice`

`backend/services/company-settings.js` normalizes these keys and falls back to the existing `companies` profile columns for the primary phone and address. `backend/routes/settings.js` preserves unrelated settings and writes only normalized invoice values. `frontend-v2` exposes the fields to admin, manager, and superadmin users on the existing Company Controls card.

The migration seeds the reference contact/remit/legal/footer text only for the existing default Crosby's tenant when its stored business name starts with `Crosby`. It does not replace the current business name or logo, and it does not seed Crosby values into other tenants.

### Immutable invoice document snapshot

`invoices.document_snapshot JSONB` stores the customer-facing document model used for an emailed invoice. `orders.salesperson_name` and `invoices.salesperson_name` preserve the sales identity that does not currently exist in the schema.

The first send builds a snapshot from:

- the complete invoice row;
- the linked order;
- the tenant-scoped customer;
- the linked stop and route;
- the assigned driver's vehicle reference when available; and
- normalized company invoice settings.

Subsequent sends reuse the snapshot so a historical invoice does not change when customer, route, or company settings are edited later. Existing invoices without a snapshot are enriched on their next send. Direct PDF downloads use an existing snapshot or build the same view model without silently modifying unrelated invoice state.

### Shared render path

`backend/services/invoice-document.js` owns data loading, normalization, snapshot construction, and piece-count calculation. `backend/services/invoice-email.js` loads the document once, renders the concise escaped HTML body, passes the same document to `backend/services/pdf.js`, sends the attachment, and records `document_snapshot` together with `sent_at` and the next invoice status.

All current send paths already call `sendInvoiceEmail`, so the shared change covers manual send/resend, signed and paid invoice messages, order fulfillment, stop completion, and accounts-receivable reminders.

## Document Model

The shared model has these stable sections:

```js
{
  seller: {
    businessName,
    logoDataUrl,
    address,
    phone,
    fax,
    afterHoursPhone,
    remitTo,
    salesTerms,
    creditTerms,
    copyLabel,
    safetyNotice,
  },
  soldTo: { name, contact, address, phone, email },
  shippedTo: { name, address },
  metadata: {
    invoiceNumber,
    customerNumber,
    salesperson,
    truckRoute,
    orderDate,
    deliveryDate,
    paymentTerms,
  },
  items: [{
    itemNumber,
    orderedQuantity,
    shippedQuantity,
    uom,
    description,
    lotNumber,
    unitPrice,
    extension,
  }],
  totals: { pieceCount, subtotal, tax, total },
  signature: { imageData, signedAt },
  proofOfDelivery: { imageData, uploadedAt },
}
```

`pieceCount` sums shipped quantities for count-based UOM values and excludes weight-based values such as pounds and kilograms.

## Security and Tenant Boundaries

- Every related-record lookup uses the invoice's company and location scope.
- Stored values are HTML-escaped before entering the email body.
- The service role remains backend-only.
- The migration adds columns to already protected tables and does not create a new exposed table or weaken RLS.
- The existing invoice logo validation and size limit remain unchanged.
- Invoice settings have bounded lengths before they are persisted or rendered.

## Error Handling

- Missing optional seller, customer, route, or driver fields render as blank or `-` without blocking the send.
- Missing customer email keeps the current non-send response.
- Missing mail configuration keeps the current service-unavailable response.
- Snapshot enrichment failure reports a send failure instead of silently sending a materially incomplete invoice.
- A mail failure does not mark the invoice sent.

## Testing and Verification

- Backend unit tests cover company setting normalization and length bounds.
- Backend document tests cover tenant-scoped enrichment, ordered versus shipped quantity, UOM, lot, metadata, piece count, and immutable snapshot reuse.
- Email tests assert the body contains only ordered items and totals, escapes stored content, and does not expose legal/lot/signature sections.
- PDF tests assert the full approved labels and sections are present in the layout source, then a rendered sample PDF is inspected through text extraction and page rendering.
- Frontend tests exercise the extracted invoice settings fields and Settings integration.
- Focused backend tests, frontend tests, TypeScript build, lint, broad backend tests, and the root build are final gates.

## Out of Scope

- A free-form invoice template builder.
- A new settings table.
- Sending or deploying the database migration from this branch.
- Changing Stripe billing, payment collection, or customer portal behavior.
- Committing the reference photo or generated preview under `Reports/`.
