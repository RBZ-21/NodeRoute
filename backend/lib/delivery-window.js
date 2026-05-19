'use strict';

/**
 * Builds a delivery window from a stop's scheduled_date and scheduled_time.
 * Returns { windowStart: ISO string, windowEnd: ISO string }.
 * windowEnd defaults to windowStart + 2 hours if only a start time is available.
 */
function buildDeliveryWindow(stop, orderCreatedAt) {
  if (stop?.scheduled_date) {
    const dateStr = stop.scheduled_date;
    const timeStr = stop?.scheduled_time || '07:00';
    const windowStart = new Date(`${dateStr}T${timeStr}Z`);
    if (Number.isFinite(windowStart.getTime())) {
      return {
        windowStart: windowStart.toISOString(),
        windowEnd: new Date(windowStart.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        isScheduled: true,
      };
    }
  }

  const fallbackStart = new Date(orderCreatedAt);
  return {
    windowStart: fallbackStart.toISOString(),
    windowEnd: new Date(fallbackStart.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    isScheduled: false,
  };
}

module.exports = { buildDeliveryWindow };
