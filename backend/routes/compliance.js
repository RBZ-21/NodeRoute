const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { filterRowsByContext, scopeQueryByContext } = require('../services/operating-context');

const router = express.Router();
router.use(authenticateToken, requireRole('admin', 'manager'));

const EVENT_DEFINITIONS = [
  { event_type: 'harvest', fields: ['harvest_date', 'catch_date', 'received_date', 'vendor_id'] },
  { event_type: 'processing', fields: ['processing_date', 'processed_at', 'received_by'] },
  { event_type: 'shipping', fields: ['shipped_at', 'ship_date', 'source_po_number', 'purchase_order_id'] },
  { event_type: 'receiving', fields: ['received_date', 'received_by', 'quantity_received'] },
];

function hasValue(row, field) {
  const value = row?.[field];
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function eventComplete(row, definition) {
  return definition.fields.some((field) => hasValue(row, field));
}

function pct(complete, total) {
  return total > 0 ? Math.round((complete / total) * 100) : 100;
}

function lotDisplayName(lot) {
  return lot?.lot_number || lot?.product_id || lot?.item_number || lot?.id || 'Unknown lot';
}

function lotLocation(lot) {
  return lot?.location_name || lot?.storage_location || lot?.warehouse_location || lot?.location_id || 'Unassigned';
}

function daysOpen(lot) {
  const created = lot?.created_at || lot?.received_date || lot?.updated_at;
  const start = created ? new Date(created) : new Date();
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
}

async function loadComplianceRows() {
  const [lotCodesResult, inventoryLotsResult] = await Promise.all([
    scopeQueryByContext(supabase.from('lot_codes').select('*'), req.context),
    scopeQueryByContext(supabase.from('inventory_lots').select('*'), req.context),
  ]);

  if (lotCodesResult.error) throw lotCodesResult.error;
  if (inventoryLotsResult.error) throw inventoryLotsResult.error;

  return {
    lotCodes: lotCodesResult.data || [],
    inventoryLots: inventoryLotsResult.data || [],
  };
}

router.get('/summary', async (req, res) => {
  try {
    const { lotCodes, inventoryLots } = await loadComplianceRows();
    const scopedLots = filterRowsByContext(lotCodes, req.context);
    const scopedInventoryLots = filterRowsByContext(inventoryLots, req.context);
    const totalEvents = scopedLots.length * EVENT_DEFINITIONS.length;
    const coveredEvents = scopedLots.reduce((sum, lot) => (
      sum + EVENT_DEFINITIONS.filter((definition) => eventComplete(lot, definition)).length
    ), 0);
    const gaps = buildGaps(scopedLots);
    const assignedTraceLots = scopedInventoryLots.filter((lot) => hasValue(lot, 'lot_number') || hasValue(lot, 'lot_code')).length;
    const traceTotal = Math.max(scopedInventoryLots.length, scopedLots.length);

    res.json({
      summary: {
        score: pct(coveredEvents, totalEvents),
        kte_covered: coveredEvents,
        kte_total: totalEvents,
        tlc_covered: assignedTraceLots || scopedLots.length,
        tlc_total: traceTotal || scopedLots.length,
        open_gaps: gaps.length,
        last_updated: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/cte-completeness', async (req, res) => {
  try {
    const { lotCodes } = await loadComplianceRows();
    const scopedLots = filterRowsByContext(lotCodes, req.context);
    const ctes = EVENT_DEFINITIONS.map((definition) => {
      const complete = scopedLots.filter((lot) => eventComplete(lot, definition)).length;
      return {
        event_type: definition.event_type,
        total: scopedLots.length,
        complete,
        pct: pct(complete, scopedLots.length),
      };
    });
    const lots = scopedLots.map((lot) => {
      const completeEvents = EVENT_DEFINITIONS.filter((definition) => eventComplete(lot, definition)).length;
      return {
        id: String(lot.id || lot.lot_number),
        lot_number: lot.lot_number,
        product_id: lot.product_id || null,
        score: pct(completeEvents, EVENT_DEFINITIONS.length),
        complete_events: completeEvents,
        total_events: EVENT_DEFINITIONS.length,
      };
    });

    res.json({ lots, ctes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function buildGaps(lots) {
  const gaps = [];
  for (const lot of lots) {
    for (const definition of EVENT_DEFINITIONS) {
      if (eventComplete(lot, definition)) continue;
      gaps.push({
        id: `${lot.id || lot.lot_number}-${definition.event_type}`,
        item: lotDisplayName(lot),
        location: lotLocation(lot),
        event_type: definition.event_type,
        gap_type: `Missing ${definition.event_type} CTE`,
        days_open: daysOpen(lot),
      });
    }
  }
  return gaps;
}

router.get('/gaps', async (req, res) => {
  try {
    const { lotCodes } = await loadComplianceRows();
    const scopedLots = filterRowsByContext(lotCodes, req.context);
    res.json({ gaps: buildGaps(scopedLots) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
