# Automated Reorder Frontend Specification

Target app: `frontend-v2`

## Routes and Navigation

Add a first-class `/reorder` route in the Operations group.

Primary APIs:

- `GET /api/reorder/dashboard`
- `GET /api/reorder/suggestions?status=pending&sort=urgency`
- `GET /api/reorder/suggestions/:id`
- `PATCH /api/reorder/suggestions/:id/approve`
- `PATCH /api/reorder/suggestions/:id/snooze`
- `PATCH /api/reorder/suggestions/:id/dismiss`
- `GET /api/reorder/product/:product_id/settings`
- `PATCH /api/reorder/product/:product_id/settings`
- `GET /api/reporting/reorder-performance`
- `GET /api/reporting/stockout-risk?days=7|14|30`
- `GET /api/reporting/inventory-turnover`

## Dashboard Alert Banner

Location: top of `DashboardPage`, above the first metrics row.

Fetch `GET /api/reorder/dashboard` with the existing authenticated API client.

Display rules:

- If `critical_count > 0`, show a red banner.
- Else if `urgent_count > 0`, show an orange banner.
- Else hide the banner.

Content:

- Critical: `{critical_count} products need immediate reordering - View Now`
- Urgent: `{urgent_count} products need reordering soon - View Now`
- The whole CTA navigates to `/reorder`.

Design:

- Full-width band inside the dashboard content column, not a nested card.
- Use existing `Button`, `Badge`, and icon patterns.
- Include product risk preview only when `stockout_risk.length > 0`: first three product names with days remaining.

## Reorder Suggestions Page

Route: `/reorder`

Layout:

- Page title: `Reorder Suggestions`
- Summary strip: critical, urgent, normal, total pending.
- Filter row: status, urgency, vendor, product search, sort.
- Main table.

Table columns:

- Select checkbox
- Product
- Stock
- Reorder Point
- Suggested Qty
- Urgency
- Days Remaining
- Vendor
- AI Confidence
- Reason
- Actions

Color coding:

- `critical`: red badge and red-tinted row marker.
- `urgent`: orange badge.
- `scheduled`: blue badge.
- `normal`: neutral/blue badge.

Low confidence warning:

- If `ai_confidence_score < 0.6`, show `Low confidence - limited history` next to the confidence value.
- If `calculation_breakdown.low_confidence_warning` exists, use that exact text in a tooltip.

Actions:

- `Approve`: calls `PATCH /api/reorder/suggestions/:id/approve`; on success, show the draft PO number and remove row from pending.
- `Snooze`: opens a modal with date/time input; calls snooze endpoint.
- `Dismiss`: opens a modal requiring a reason; calls dismiss endpoint.

Bulk approve:

- Allow selecting multiple pending suggestions.
- Group selected rows by `vendor_id`.
- Send one approve request per suggestion for the first backend release, then show a grouped summary by vendor.
- Future optimization can add a backend bulk endpoint to create one PO per vendor with multiple lines.

Detail drawer:

- Clicking a row opens a side drawer.
- Show product, vendor, current stock, reorder point, suggested quantity, urgency, AI confidence, reason, and the full `calculation_breakdown`.
- Display calculation sections: usage, seasonality, upcoming demand, MOQ/max stock, urgency.

## Product Reorder Settings Panel

Entry points:

- Product row in Inventory page: add `Reorder Settings` action.
- Reorder suggestion detail drawer: add `Edit Settings`.

Form fields:

- Toggle: `reorder_enabled`
- Number inputs: `reorder_point`, `reorder_quantity`, `safety_stock`, `lead_time_days`, `min_order_quantity`, `max_stock_level`, `avg_daily_usage`
- Vendor selector: `preferred_vendor_id`
- Read-only: `usage_trend`, `last_reorder_calc_at`

Calculated vs manual:

- Fetch `GET /api/reorder/product/:product_id/settings`.
- Show current manual values and `system_calculated` values side by side.
- Provide a `Use calculated values` button that copies calculated reorder point and average usage into the form, but only saves after the user clicks `Save`.

Usage sparkline:

- Use `system_calculated.usage` plus a future `product_usage_history` endpoint if added.
- Until then, show the latest average/trend summary and reserve the chart area with an empty state: `Usage history will appear after the next recalculation.`

Validation:

- Lead time: integer 1-365.
- MOQ: positive number.
- Safety stock, reorder point, max stock: non-negative.
- If max stock is set and less than current stock, show warning but allow save.

## Reporting UI

Add three report cards to Reports page:

- Reorder Performance: approval/dismissal counts, average hours to PO, low confidence count.
- Stockout Risk: horizon selector 7/14/30 days and risk table.
- Inventory Turnover: fastest movers and slow movers.

Use existing report page visual density. These are operational tables, not marketing cards.
