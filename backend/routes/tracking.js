const express = require('express');
const { supabase } = require('../services/supabase');
const { filterRowsByContext, rowMatchesContext, scopeQueryByContext } = require('../services/operating-context');
const { buildDeliveryWindow } = require('../lib/delivery-window');
const { getMedianDwellMs } = require('../services/dwell-stats');
const { clientError } = require('../lib/safe-error');

const router = express.Router();
const STALE_THRESHOLD_SECONDS = 120;

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function haversineMiles(a, b) {
  const lat1 = toNumber(a?.lat);
  const lng1 = toNumber(a?.lng);
  const lat2 = toNumber(b?.lat);
  const lng2 = toNumber(b?.lng);
  if ([lat1, lng1, lat2, lng2].some((value) => value === null)) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const startLat = toRad(lat1);
  const endLat = toRad(lat2);

  const aCalc =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(aCalc), Math.sqrt(1 - aCalc));
}

function buildDestination(order, orderedStops, matchedStopIndex) {
  const customerLat = toNumber(order.customer_lat);
  const customerLng = toNumber(order.customer_lng);
  if (customerLat !== null && customerLng !== null) {
    return { lat: customerLat, lng: customerLng };
  }

  if (matchedStopIndex >= 0) {
    return {
      lat: toNumber(orderedStops[matchedStopIndex].lat),
      lng: toNumber(orderedStops[matchedStopIndex].lng),
    };
  }

  return { lat: null, lng: null };
}

function findMatchingStopIndex(order, orderedStops) {
  if (order.stop_id) {
    const directIndex = orderedStops.findIndex((stop) => String(stop.id) === String(order.stop_id));
    if (directIndex >= 0) return directIndex;
  }

  const orderAddress = normalize(order.customer_address);
  const orderName = normalize(order.customer_name);

  return orderedStops.findIndex((stop) => {
    const stopAddress = normalize(stop.address);
    const stopName = normalize(stop.name);
    return (
      (!!orderAddress && stopAddress === orderAddress) ||
      (!!orderName && stopName === orderName) ||
      (!!orderAddress && !!stopAddress && (stopAddress.includes(orderAddress) || orderAddress.includes(stopAddress))) ||
      (!!orderName && !!stopName && (stopName.includes(orderName) || orderName.includes(stopName)))
    );
  });
}

function buildEta(driver, destination, stopsBeforeYou, activeDwellMinutes, medianStopMs = 8 * 60 * 1000) {
  const miles = haversineMiles(driver, destination);
  if (miles === null) return null;

  const speedMph = Math.max(18, toNumber(driver.speed_mph, 28));
  const driveMinutes = Math.max(1, Math.round((miles / speedMph) * 60));
  const medianStopMinutes = medianStopMs / 60000;
  const dwellMinutes = Math.max(0, Math.round(activeDwellMinutes + Math.max(stopsBeforeYou - 1, 0) * medianStopMinutes));
  const totalMinutes = driveMinutes + dwellMinutes;
  const etaDate = new Date(Date.now() + totalMinutes * 60 * 1000);

  return {
    totalMinutes,
    driveMinutes,
    dwellMinutes,
    medianStopMinutes: parseFloat(medianStopMinutes.toFixed(1)),
    etaIsEstimated: true,
    etaTime: etaDate.toISOString(),
    legs: [{ withTraffic: false }],
  };
}

function evaluateDriverLocation(driverLocation, thresholdSeconds = STALE_THRESHOLD_SECONDS) {
  const lastUpdatedSecondsAgo = driverLocation?.updated_at
    ? Math.round((Date.now() - new Date(driverLocation.updated_at).getTime()) / 1000)
    : null;
  const locationIsStale = lastUpdatedSecondsAgo === null || lastUpdatedSecondsAgo > thresholdSeconds;
  return { lastUpdatedSecondsAgo, locationIsStale };
}

function buildDriverResponse(driverName, route, driverLocation) {
  const { lastUpdatedSecondsAgo, locationIsStale } = evaluateDriverLocation(driverLocation);
  return {
    name: driverName,
    userId: route?.driver_id || null,
    lat: locationIsStale ? null : toNumber(driverLocation?.lat),
    lng: locationIsStale ? null : toNumber(driverLocation?.lng),
    heading: locationIsStale ? null : toNumber(driverLocation?.heading, 0),
    speed_mph: locationIsStale ? null : toNumber(driverLocation?.speed_mph, 0),
    updatedAt: driverLocation?.updated_at || null,
    lastUpdatedSecondsAgo,
    last_updated_seconds_ago: lastUpdatedSecondsAgo,
    locationIsStale,
    locationStatus: locationIsStale ? 'stale' : 'live',
  };
}

function routeHasStarted(route) {
  if (!route) return false;
  if (route.dispatched_at) return true;
  const status = normalize(route.status);
  return status === 'active' || status === 'completed';
}

router.get('/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Tracking token required' });

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('tracking_token', token)
    .single();

  if (orderError || !order) {
    return res.status(404).json({ error: 'This tracking link is invalid or no longer available.' });
  }

  if (order.tracking_expires_at && new Date(order.tracking_expires_at).getTime() <= Date.now()) {
    return res.status(410).json({ error: 'This tracking link has expired. Please request a new one.' });
  }

  const trackingContext = {
    companyId: order.company_id || null,
    activeLocationId: order.location_id || null,
    accessibleLocationIds: order.location_id ? [order.location_id] : [],
    isGlobalOperator: false,
  };

  let route = null;
  let orderedStops = [];
  if (order.route_id) {
    const { data: routeData, error: routeError } = await supabase
      .from('routes')
      .select('*')
      .eq('id', order.route_id)
      .single();
    if (routeError && routeError.code !== 'PGRST116') {
      return res.status(500).json({ error: clientError(routeError, 'Failed to load route details') });
    }
    route = routeData && rowMatchesContext(routeData, trackingContext) ? routeData : null;

    if (route?.stop_ids?.length) {
      const { data: routeStops, error: stopsError } = await supabase
        .from('stops')
        .select('*')
        .in('id', route.stop_ids);
      if (stopsError) {
        return res.status(500).json({ error: clientError(stopsError, 'Failed to load route stops') });
      }

      const scopedStops = filterRowsByContext(routeStops || [], trackingContext);
      const stopMap = Object.fromEntries(scopedStops.map((stop) => [stop.id, stop]));
      orderedStops = (route.stop_ids || []).map((stopId) => stopMap[stopId]).filter(Boolean);
    }
  }

  const matchedStopIndex = findMatchingStopIndex(order, orderedStops);
  const destination = buildDestination(order, orderedStops, matchedStopIndex);
  const driverName = order.driver_name || route?.driver || 'NodeRoute Driver';
  const outingStarted = routeHasStarted(route);

  // Branding for the public tracking page: company display name + logo.
  // Only non-sensitive presentation fields are exposed (no order contents,
  // pricing, or any other tenant data).
  let company = { name: 'NodeRoute', logoUrl: null };
  if (order.company_id) {
    const { data: companyRow } = await supabase
      .from('companies')
      .select('id,name,settings')
      .eq('id', order.company_id)
      .single();
    if (companyRow) {
      const settings = companyRow.settings || {};
      company = {
        name: companyRow.name || company.name,
        logoUrl: settings.invoice_logo_data_url || settings.logo_url || null,
      };
    }
  }

  const driverLocationQuery = route?.driver_id
    ? scopeQueryByContext(supabase.from('driver_locations').select('*'), trackingContext).eq('user_id', route.driver_id)
    : scopeQueryByContext(supabase.from('driver_locations').select('*'), trackingContext).ilike('driver_name', driverName);
  const { data: driverLocations, error: driverLocationError } = await driverLocationQuery
    .order('updated_at', { ascending: false })
    .limit(10);
  if (driverLocationError) {
    return res.status(500).json({ error: clientError(driverLocationError, 'Failed to load driver location') });
  }

  const scopedDriverLocations = filterRowsByContext(driverLocations || [], trackingContext);
  const driverLocation = scopedDriverLocations.length ? scopedDriverLocations[0] : null;
  const driver = buildDriverResponse(driverName, route, driverLocation);
  const { lastUpdatedSecondsAgo, locationIsStale } = driver;

  let completedStopIds = new Set();
  let activeDwellMinutes = 0;
  let medianDwellMs = 8 * 60 * 1000;
  if (order.route_id) {
    const { data: dwellRows } = await supabase
      .from('dwell_records')
      .select('stop_id, arrived_at, departed_at')
      .eq('route_id', order.route_id);
    const relevantDwell = dwellRows || [];
    completedStopIds = new Set(relevantDwell.filter((r) => r.departed_at).map((r) => r.stop_id));
    const activeDwell = relevantDwell.find((r) => !r.departed_at) || null;
    activeDwellMinutes = activeDwell ? (Date.now() - new Date(activeDwell.arrived_at).getTime()) / 60000 : 0;
    medianDwellMs = await getMedianDwellMs(supabase, trackingContext);
  }

  const stopsBeforeYou =
    matchedStopIndex >= 0
      ? orderedStops.slice(0, matchedStopIndex).filter((stop) => !completedStopIds.has(stop.id)).length
      : 0;

  const matchedStop = matchedStopIndex >= 0 ? orderedStops[matchedStopIndex] : null;
  const deliveryWindow = buildDeliveryWindow(matchedStop, order.created_at);
  const delivered = order.status === 'invoiced' || order.status === 'delivered';
  const eta = delivered || !outingStarted || locationIsStale
    ? null
    : buildEta(driver, destination, stopsBeforeYou, activeDwellMinutes, medianDwellMs);
  const etaUnavailableReason = !outingStarted
    ? 'route_not_started'
    : locationIsStale
      ? 'driver_location_stale'
      : delivered
        ? 'delivered'
        : null;

  res.json({
    orderId: order.id,
    orderNumber: order.order_number,
    company,
    status: order.status,
    deliveryAddress: order.customer_address,
    customerName: order.customer_name,
    outingStarted,
    routeDispatchedAt: route?.dispatched_at || null,
    lastUpdatedSecondsAgo,
    last_updated_seconds_ago: lastUpdatedSecondsAgo,
    stopsBeforeYou,
    totalRouteStops: orderedStops.length,
    driver,
    destination,
    deliveryWindow,
    eta,
    etaUnavailableReason,
  });
});

module.exports = router;
module.exports.buildEta = buildEta;
module.exports.findMatchingStopIndex = findMatchingStopIndex;
module.exports.buildDestination = buildDestination;
module.exports.evaluateDriverLocation = evaluateDriverLocation;
module.exports.buildDriverResponse = buildDriverResponse;
module.exports.STALE_THRESHOLD_SECONDS = STALE_THRESHOLD_SECONDS;
