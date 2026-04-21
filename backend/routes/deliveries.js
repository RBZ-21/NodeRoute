const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { supabase } = require('../services/supabase');
const { filterRowsByContext, rowMatchesContext } = require('../services/operating-context');
const { dwellRecords } = require('./stops');

const router = express.Router();

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function haversineMiles(a, b) {
  const lat1 = toNumber(a?.lat, null);
  const lng1 = toNumber(a?.lng, null);
  const lat2 = toNumber(b?.lat, null);
  const lng2 = toNumber(b?.lng, null);
  if ([lat1, lng1, lat2, lng2].some((value) => value === null)) return 0;

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

function mapOrderStatus(order, activeDriver) {
  if (order.status === 'invoiced' || order.status === 'delivered') return 'delivered';
  if (order.status === 'failed') return 'failed';
  if (activeDriver || order.status === 'in_process' || order.status === 'processed') return 'in-transit';
  return 'pending';
}

function findMatchingStop(order, orderedStops) {
  const orderAddress = normalize(order.customer_address);
  const orderName = normalize(order.customer_name);

  return (
    orderedStops.find((stop) => {
      const stopAddress = normalize(stop.address);
      const stopName = normalize(stop.name);
      return (
        (!!orderAddress && stopAddress === orderAddress) ||
        (!!orderName && stopName === orderName) ||
        (!!orderAddress && !!stopAddress && (stopAddress.includes(orderAddress) || orderAddress.includes(stopAddress))) ||
        (!!orderName && !!stopName && (stopName.includes(orderName) || orderName.includes(stopName)))
      );
    }) || null
  );
}

function sameDay(date, target) {
  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

async function loadDashboardContext(context) {
  const [
    ordersResult,
    routesResult,
    stopsResult,
    driverLocationsResult,
    usersResult,
    contactsResult,
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_address, customer_email, items, status, notes, created_at, driver_name, route_id, customer_lat, customer_lng')
      .order('created_at', { ascending: false }),
    supabase.from('routes').select('id, name, stop_ids, driver, notes, created_at'),
    supabase.from('stops').select('id, name, address, lat, lng, notes, door_code, created_at'),
    supabase.from('driver_locations').select('driver_name, lat, lng, heading, speed_mph, updated_at'),
    supabase.from('users').select('id, name, email, role, status, created_at').order('created_at', { ascending: true }),
    supabase.from('portal_contacts').select('name, email, door_code, phone'),
  ]);

  const errors = [
    ordersResult.error,
    routesResult.error,
    stopsResult.error,
    driverLocationsResult.error,
    usersResult.error,
    contactsResult.error,
  ].filter(Boolean);

  if (errors.length) {
    throw new Error(errors[0].message);
  }

  const orders = filterRowsByContext(ordersResult.data || [], context);
  const routes = filterRowsByContext(routesResult.data || [], context);
  const stops = filterRowsByContext(stopsResult.data || [], context);
  const stopMap = Object.fromEntries(stops.map((stop) => [stop.id, stop]));
  const driverLocations = filterRowsByContext(driverLocationsResult.data || [], context);
  const locationMap = Object.fromEntries(driverLocations.map((loc) => [normalize(loc.driver_name), loc]));
  const contacts = filterRowsByContext(contactsResult.data || [], context);
  const contactDoorMap = {};
  contacts.forEach((contact) => {
    const byName = normalize(contact.name);
    const byEmail = normalize(contact.email);
    if (contact.door_code) {
      if (byName) contactDoorMap[byName] = contact.door_code;
      if (byEmail) contactDoorMap[byEmail] = contact.door_code;
    }
  });

  const routeMap = {};
  routes.forEach((route) => {
    routeMap[route.id] = {
      ...route,
      orderedStops: (route.stop_ids || []).map((stopId) => stopMap[stopId]).filter(Boolean),
    };
  });

  const deliveries = orders.map((order, index) => {
    const route = order.route_id ? routeMap[order.route_id] : null;
    const matchedStop = route ? findMatchingStop(order, route.orderedStops) : null;
    const driverName = order.driver_name || route?.driver || 'Unassigned';
    const driverLocation = locationMap[normalize(driverName)] || null;

    const activeDwell = matchedStop
      ? dwellRecords.find((record) => record.stopId === matchedStop.id && String(record.routeId || '') === String(order.route_id || '') && !record.departedAt)
      : null;
    const completedDwell = matchedStop
      ? dwellRecords.find((record) => record.stopId === matchedStop.id && String(record.routeId || '') === String(order.route_id || '') && !!record.departedAt)
      : null;

    const destination = {
      lat: toNumber(order.customer_lat, toNumber(matchedStop?.lat, 0)),
      lng: toNumber(order.customer_lng, toNumber(matchedStop?.lng, 0)),
    };
    const driverCoords = {
      lat: toNumber(driverLocation?.lat, destination.lat),
      lng: toNumber(driverLocation?.lng, destination.lng),
    };
    const status = mapOrderStatus(order, !!driverLocation);
    const createdAt = new Date(order.created_at);
    const stopDurationMinutes = completedDwell?.dwellMs
      ? Math.round(completedDwell.dwellMs / 60000)
      : activeDwell?.arrivedAt
        ? Math.max(1, Math.round((Date.now() - new Date(activeDwell.arrivedAt).getTime()) / 60000))
        : null;
    const distanceMiles = Number(haversineMiles(driverCoords, destination).toFixed(1));
    const deliveryDoor =
      matchedStop?.door_code ||
      contactDoorMap[normalize(order.customer_name)] ||
      contactDoorMap[normalize(order.customer_email)] ||
      'No code';

    const itemList = Array.isArray(order.items)
      ? order.items.map((item) => item.name || item.description || item.item || 'Item')
      : [];

    return {
      id: index + 1,
      orderDbId: order.id,
      orderId: order.order_number || String(order.id).slice(0, 8).toUpperCase(),
      restaurantName: order.customer_name || 'Customer',
      restaurant: order.customer_name || 'Customer',
      driverName,
      driver: driverName,
      status,
      deliveryDoor,
      onTime: status === 'delivered' ? true : null,
      address: order.customer_address || matchedStop?.address || '—',
      distanceMiles,
      expectedWindowStart: order.created_at,
      expectedWindowEnd: new Date(createdAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      startTime: route?.created_at || order.created_at,
      endTime: status === 'delivered' ? (completedDwell?.departedAt || order.created_at) : null,
      stopDurationMinutes,
      speedMph: Number(toNumber(driverLocation?.speed_mph, 0).toFixed(1)),
      items: itemList,
      lat: destination.lat || null,
      lng: destination.lng || null,
      driverLat: driverCoords.lat || null,
      driverLng: driverCoords.lng || null,
      routeId: order.route_id || null,
      createdAt: order.created_at,
      userFacingId: order.id,
    };
  });

  const users = filterRowsByContext(usersResult.data || [], context);
  const driverUsers = users.filter((user) => user.role === 'driver');
  const driverSummaries = driverUsers.map((user) => {
    const myDeliveries = deliveries.filter((delivery) => normalize(delivery.driverName) === normalize(user.name));
    const completed = myDeliveries.filter((delivery) => delivery.status === 'delivered');
    const activeLocation = locationMap[normalize(user.name)] || null;
    const onDuty = myDeliveries.some((delivery) => delivery.status === 'pending' || delivery.status === 'in-transit') ||
      (activeLocation?.updated_at && (Date.now() - new Date(activeLocation.updated_at).getTime()) < 30 * 60 * 1000);

    return {
      id: user.id,
      name: user.name,
      vehicleId: 'Assigned Vehicle',
      phone: '—',
      status: onDuty ? 'on-duty' : 'off-duty',
      onTimeRate: completed.length ? Math.round((completed.filter((delivery) => delivery.onTime !== false).length / completed.length) * 100) : 100,
      totalStopsToday: completed.length,
      milesToday: Number(myDeliveries.reduce((sum, delivery) => sum + toNumber(delivery.distanceMiles, 0), 0).toFixed(1)),
      avgStopMinutes: completed.length
        ? Math.round(completed.reduce((sum, delivery) => sum + toNumber(delivery.stopDurationMinutes, 0), 0) / completed.length)
        : 0,
      avgSpeedMph: Number(
        (
          (activeLocation ? toNumber(activeLocation.speed_mph, 0) : 0) ||
          (myDeliveries.length ? myDeliveries.reduce((sum, delivery) => sum + toNumber(delivery.speedMph, 0), 0) / myDeliveries.length : 0)
        ).toFixed(1)
      ),
      lat: toNumber(activeLocation?.lat, 32.7765),
      lng: toNumber(activeLocation?.lng, -79.9311),
      updatedAt: activeLocation?.updated_at || null,
    };
  });

  return { deliveries, drivers: driverSummaries };
}

function buildStats(deliveries, drivers) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const todayDeliveries = deliveries.filter((delivery) => sameDay(new Date(delivery.createdAt), today));
  const yesterdayDeliveries = deliveries.filter((delivery) => sameDay(new Date(delivery.createdAt), yesterday));

  const summarize = (list) => {
    const completed = list.filter((delivery) => delivery.status === 'delivered');
    return {
      totalDeliveries: list.length,
      completedToday: completed.length,
      onTimeRate: completed.length
        ? Math.round((completed.filter((delivery) => delivery.onTime !== false).length / completed.length) * 100)
        : 0,
      activeDrivers: new Set(list.filter((delivery) => delivery.status === 'pending' || delivery.status === 'in-transit').map((delivery) => delivery.driverName)).size,
      totalDrivers: drivers.length,
      failed: list.filter((delivery) => delivery.status === 'failed').length,
      pendingCount: list.filter((delivery) => delivery.status === 'pending').length,
      inTransitCount: list.filter((delivery) => delivery.status === 'in-transit').length,
    };
  };

  return {
    ...summarize(todayDeliveries),
    yesterday: summarize(yesterdayDeliveries),
  };
}

function buildAnalytics(deliveries, drivers) {
  const completed = deliveries.filter((delivery) => delivery.status === 'delivered');
  const deliveriesByHour = Array.from({ length: 24 }, (_, hour) =>
    deliveries.filter((delivery) => new Date(delivery.createdAt).getHours() === hour).length
  );

  const weeklyTrend = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    return deliveries.filter((delivery) => sameDay(new Date(delivery.createdAt), day)).length;
  });

  const doorBreakdown = deliveries.reduce((acc, delivery) => {
    const key = delivery.deliveryDoor && delivery.deliveryDoor !== 'No code' ? 'Door code on file' : 'No code';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const peakHours = deliveriesByHour
    .map((count, hour) => ({
      hour: hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`,
      count,
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const driverRankings = drivers
    .map((driver) => ({
      name: driver.name,
      stopsPerHour: Number((driver.totalStopsToday / 8).toFixed(1)),
      avgStopMinutes: Number(toNumber(driver.avgStopMinutes, 0).toFixed(1)),
      avgSpeedMph: Number(toNumber(driver.avgSpeedMph, 0).toFixed(1)),
      onTimeRate: Number(toNumber(driver.onTimeRate, 100).toFixed(1)),
      milesToday: Number(toNumber(driver.milesToday, 0).toFixed(1)),
    }))
    .sort((a, b) => b.onTimeRate - a.onTimeRate || b.stopsPerHour - a.stopsPerHour);

  const avgStopTime = completed.length
    ? (completed.reduce((sum, delivery) => sum + toNumber(delivery.stopDurationMinutes, 0), 0) / completed.length).toFixed(1)
    : '0.0';
  const onTimeRate = completed.length
    ? ((completed.filter((delivery) => delivery.onTime !== false).length / completed.length) * 100).toFixed(1)
    : '0.0';
  const avgSpeed = drivers.length
    ? (drivers.reduce((sum, driver) => sum + toNumber(driver.avgSpeedMph, 0), 0) / drivers.length).toFixed(1)
    : '0.0';

  return {
    avgStopTime,
    onTimeRate,
    avgSpeed,
    peakHours,
    driverRankings,
    totalDeliveries: deliveries.length,
    completedToday: completed.length,
    deliveriesByHour,
    weeklyTrend,
    doorBreakdown,
  };
}

router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { deliveries, drivers } = await loadDashboardContext(req.context);
    res.json(buildStats(deliveries, drivers));
  } catch (error) {
    console.error('deliveries/stats:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/deliveries', authenticateToken, async (req, res) => {
  try {
    const { deliveries } = await loadDashboardContext(req.context);
    if (req.user.role === 'driver') {
      return res.json(deliveries.filter((delivery) => normalize(delivery.driverName) === normalize(req.user.name)));
    }
    res.json(deliveries);
  } catch (error) {
    console.error('deliveries/list:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/drivers', authenticateToken, async (req, res) => {
  try {
    const { drivers } = await loadDashboardContext(req.context);
    res.json(drivers);
  } catch (error) {
    console.error('deliveries/drivers:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { deliveries, drivers } = await loadDashboardContext(req.context);
    res.json(buildAnalytics(deliveries, drivers));
  } catch (error) {
    console.error('deliveries/analytics:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.patch('/deliveries/:id/status', authenticateToken, async (req, res) => {
  const requestedStatus = String(req.body?.status || '').trim();
  const allowed = {
    pending: 'pending',
    'in-transit': 'in_process',
    delivered: 'invoiced',
  };

  if (!allowed[requestedStatus]) {
    return res.status(400).json({ error: 'Invalid delivery status' });
  }

  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !order) return res.status(404).json({ error: 'Not found' });
  if (!rowMatchesContext(order, req.context)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.user.role === 'driver' && normalize(order.driver_name) !== normalize(req.user.name)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update({ status: allowed[requestedStatus] })
    .eq('id', req.params.id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  try {
    const { deliveries } = await loadDashboardContext(req.context);
    const updated = deliveries.find((delivery) => delivery.orderDbId === req.params.id);
    res.json(updated || { id: req.params.id, status: requestedStatus });
  } catch (loadError) {
    res.json({ id: req.params.id, status: requestedStatus });
  }
});

module.exports = router;
