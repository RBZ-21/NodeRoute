# NodeRoute Customer Training Guide

Version: 1.0  
Prepared for customer training and print handouts  
Date: April 22, 2026

---

## How To Use This Guide

- Audience: operations leads, dispatchers, warehouse staff, finance/admin, and managers.
- Format: instructor-led walkthrough + hands-on practice.
- Print recommendation: print double-sided, portrait, with section dividers.

---

## Training Outcomes

By the end of training, customers should be able to:

1. Log in and navigate the workspace confidently.
2. Create and process customer orders through invoice-ready fulfillment.
3. Use Planning and Purchasing to generate and execute supplier purchase orders.
4. Understand Warehouse functions as internal location operations (not supplier ordering).
5. Use Analytics rollups for customer, route, driver, and SKU performance.
6. Use Customer Portal payment flows (including Stripe-backed payment method setup).

---

## Suggested Training Agenda (Half-Day)

1. Platform orientation (20 min)
2. Orders to invoice workflow (45 min)
3. Planning, vendors, purchasing, and receiving (60 min)
4. Warehouse operations and returns (25 min)
5. Reporting rollups and analytics (20 min)
6. Portal payments and collections workflow (20 min)
7. Role-based Q&A and go-live checklist (20 min)

---

## Module 1: Platform Orientation

### Goals

- Confirm login access.
- Explain nav groups and where key actions happen.

### Key Talking Points

- `Orders` is customer sales workflow.
- `Operations > Planning` creates draft purchase orders.
- `Operations > Purchasing` executes vendor POs and receiving.
- `Operations > Warehouse` is your own locations/scans/returns.
- `Financials > Analytics` includes Unified Performance Rollups.

### Live Demo Steps

1. Open the landing page and click `Login`.
2. Sign in with manager credentials.
3. Show sidebar groups: Logistics, People, Financials, Operations, AI Help.
4. Click each Operations tab to show functional boundaries.

---

## Module 2: Orders Through Fulfillment

### Goals

- Enter an order, process it, fulfill it, and produce an invoice.

### Live Demo Steps

1. Go to `Orders` and create a new order for a sample customer.
2. Add line items and notes.
3. Send order to processing.
4. Fulfill the order: enter final weights/quantities.
5. Review invoice result and customer-facing status.

### Practice Exercise

- Trainee creates one order with mixed unit types (`lb` and `each`) and fulfills it.

### Validation Checklist

- Order appears in queue.
- Status transitions complete correctly.
- Invoice is created and visible.

---

## Module 3: Planning, Vendors, and Purchasing

### Goals

- Train supplier-ordering flow end-to-end.

### Business Explanation

- `Planning` answers: "What should we buy?"
- `Purchasing` answers: "What did we place and what did we receive?"

### A. Add Vendor Data

1. Open `Operations > Vendors`.
2. Click `+ Add Vendor`.
3. Enter:
   - Vendor name
   - Contact name
   - Email/phone
   - Lead time days
   - Payment terms
   - Notes
4. Save and confirm vendor appears in Vendor Directory.

### B. Generate Draft PO

1. Open `Operations > Planning`.
2. Set `Lead time days` and `Coverage days`.
3. Click `Recalculate`.
4. Enter optional vendor name and click `Create Draft PO`.

### C. Execute Vendor PO

1. Open `Operations > Purchasing`.
2. In `Draft Purchase Orders`, click `Create Vendor PO`.
3. Confirm PO appears in `Vendor Purchase Orders & Receiving`.
4. Filter/search as needed.

### D. Receive Inventory

1. Click `Receive` on an open/partial/backordered vendor PO.
2. Enter actual received quantities and costs.
3. Submit receipt.
4. Verify inventory updates.

### Validation Checklist

- Draft PO created.
- Vendor PO created from draft.
- Receipt posted.
- Inventory reflects receipt.

---

## Module 4: Warehouse Operations

### Goals

- Clarify warehouse purpose and train location-level operations.

### Key Clarification (Important)

- `Warehouse` is for your internal sites (coolers, depots, storage zones).
- Supplier ordering is done in `Planning` and `Purchasing`, not Warehouse.

### Live Demo Steps

1. Open `Operations > Warehouse`.
2. Add one internal warehouse/location.
3. Log one barcode event.
4. Create one return record.

### Validation Checklist

- Warehouse count increases.
- Scan event appears.
- Return appears with status.

---

## Module 5: Reporting and Analytics

### Goals

- Use rollups to support operational and margin decisions.

### Live Demo Steps

1. Open `Financials > Analytics`.
2. In `Unified Performance Rollups`, set start/end dates.
3. Set row limit and refresh.
4. Review grouped sections:
   - By customer
   - By route
   - By driver
   - By SKU

### Coaching Prompts

- Which customer groups are most profitable?
- Which route/driver combinations show margin pressure?
- Which SKUs have high revenue but low margin?

---

## Module 6: Customer Portal Payments

### Goals

- Explain payment setup and payment execution options.

### Live Demo Steps

1. Open customer portal payment settings.
2. Save payment method using secure Payment Element.
3. Show one-time payment path and checkout session path.
4. Explain autopay/charge-now flow and webhook-backed status updates.

### Customer-Facing Explanation

- Payment data is handled through Stripe flows.
- Payment success/failure updates are driven by webhook events.

---

## Role-Based Quick Guides

### Dispatcher / Ops Coordinator

1. Create and route orders.
2. Monitor status and delivery progress.
3. Hand off to fulfillment and invoicing.

### Purchasing Lead

1. Review planning suggestions.
2. Create draft POs.
3. Convert drafts to vendor POs.
4. Receive and reconcile.

### Warehouse Lead

1. Maintain internal warehouse locations.
2. Log scans and returns.
3. Verify receiving updates inventory.

### Finance / Admin

1. Review invoice/payment status.
2. Run analytics rollups.
3. Track revenue/cost/margin trends.

---

## AI Walkthrough Usage (In-App)

Use `AI Help > Walkthroughs` to generate role-specific help for:

- Planning (draft PO generation)
- Purchasing (vendor PO + receiving)
- Warehouse operations
- Reporting rollups
- Portal payments

Tip: Ask direct prompts like, `Show me how to create a draft PO then receive a vendor PO.`

---

## Common Issues and Trainer Responses

### "I cannot find where to order from suppliers"

- Response: "Use Operations > Planning to generate drafts and Operations > Purchasing to place/receive supplier POs. Warehouse is internal locations only."

### "Purchasing looks empty"

- Response: "Click Create Draft PO in Planning first, then convert to vendor PO. Purchasing is execution and receiving."

### "Draft PO creation error mentions orders table"

- Response: "The system now degrades gracefully if legacy order usage history is missing. You can still generate draft POs from available inventory/suggestion data."

### "What does warehouse mean?"

- Response: "Warehouse means your own storage sites/depots and operational logging, not vendors."

---

## Go-Live Checklist

1. Login verified for each role.
2. At least one vendor record added.
3. Draft PO generated and converted to vendor PO.
4. One vendor PO receipt posted successfully.
5. Warehouse location and barcode event logged.
6. Rollup report run with live date filters.
7. Portal payment method save tested.
8. Team knows where to get AI walkthrough help.

---

## Trainer Sign-Off Page (Print)

Customer Name: _______________________________  
Training Date: ________________________________  
Trainer: ______________________________________  

Modules Completed:

- [ ] Platform Orientation
- [ ] Orders Through Fulfillment
- [ ] Planning / Vendors / Purchasing
- [ ] Warehouse Operations
- [ ] Reporting and Analytics
- [ ] Portal Payments

Open Action Items:

1. _____________________________________________
2. _____________________________________________
3. _____________________________________________

Customer Acceptance Signature: _______________________________  
Trainer Signature: ____________________________________________

---

## Appendix: 1-Page Quick Reference

### Where do I...?

- Create customer order: `Orders`
- Generate draft supplier PO: `Operations > Planning`
- Convert draft to vendor PO and receive: `Operations > Purchasing`
- Add/manage suppliers: `Operations > Vendors`
- Manage internal locations/scans/returns: `Operations > Warehouse`
- View rollup reporting: `Financials > Analytics`
- Walkthrough guidance: `AI Help > Walkthroughs`

### Rule of thumb

- Planning = Decide what to buy
- Purchasing = Place and receive supplier orders
- Warehouse = Internal operational locations and logs
