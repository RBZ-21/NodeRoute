'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateParams, validateQuery } = require('../lib/zod-validate');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../services/operating-context');
const googleMaps = require('../services/google-maps');

const router = express.Router();
const managerMapsRoles = requireRole('admin', 'manager');
const routeMapsRoles = requireRole('admin', 'manager', 'driver');

const customerParamsSchema = z.object({
  customerId: z.string().trim().min(1),
});

const driveTimeQuerySchema = z.object({
  from: z.string().trim().min(1, 'from is required'),
  to: z.string().trim().min(1, 'to is required'),
  mode: z.enum(['driving', 'walking', 'bicycling', 'transit']).optional().default('driving'),
});

const routeParamsSchema = z.object({
  routeId: z.string().trim().min(1),
});

function normalizeAddress(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function addressHash(value) {
  return crypto.createHash('sha256').update(normalizeAddress(value).toLowerCase()).digest('hex');
}

function formatCustomerAddress(customer) {
  return normalizeAddress(customer?.address || customer?.billing_address || customer?.shipping_address || '');
}

function formatLocationAddress(location) {
  const direct = normalizeAddress(location?.address || location?.street_address || '');
  const pieces = [
    direct,
    location?.city,
    location?.state,
    location?.postal_code,
    location?.country,
  ].map(normalizeAddress).filter(Boolean);
  return normalizeAddress(pieces.join(', '));
}

function numberOrNull(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function todayBucket() {
  return new Date().toISOString().slice(0, 10);
}

function firstScoped(rows, context) {
  return filterRowsByContext(rows || [], context)[0] || null;
}

function sendMapsError(res, error, fallback) {
  const status = Number(error?.status) || 500;
  const body = {
    error: error?.message || fallback,
  };
  if (error?.code) body.code = error.code;
  if (error?.mapsStatus) body.maps_status = error.mapsStatus;
  return res.status(status).json(body);
}

function isRouteAssignedToUser(route, user) {
  if (!route || !user) return false;
  if (route.driver_id && String(route.driver_id) === String(user.id)) return true;
  if (route.driver_email && String(route.driver_email).toLowerCase() === String(user.email || '').toLowerCase()) return true;
  if (route.driver && String(route.driver).trim().toLowerCase() === String(user.name || '').trim().toLowerCase()) return true;
  return false;
}

async function loadCustomer(customerId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('Customers').select('*'),
    context,
  )
    .eq('id', customerId)
    .limit(1);
  if (error) throw error;
  return firstScoped(data, context);
}

async function loadLocation(locationId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('locations').select('*'),
    context,
  )
    .eq('id', locationId)
    .limit(1);
  if (error) throw error;
  return firstScoped(data, context);
}

async function readCustomerGeocode(customer, context) {
  const address = formatCustomerAddress(customer);
  if (!address) return null;
  const hash = addressHash(address);
  const { data, error } = await scopeQueryByContext(
    supabase.from('customer_geocodes').select('*'),
    context,
    { companyField: 'company_id' },
  )
    .eq('customer_id', String(customer.id))
    .eq('address_hash', hash)
    .limit(1);
  if (error) throw error;
  return firstScoped(data, context);
}

async function geocodeCustomer(customer, context) {
  const address = formatCustomerAddress(customer);
  if (!address) {
    const error = new Error('Invalid customer address');
    error.status = 400;
    error.code = 'INVALID_CUSTOMER_ADDRESS';
    throw error;
  }
  const hash = addressHash(address);
  const cached = await readCustomerGeocode(customer, context);
  if (cached) {
    return {
      customer_id: String(customer.id),
      address_hash: hash,
      lat: numberOrNull(cached.lat),
      lng: numberOrNull(cached.lng),
      formatted_address: cached.formatted_address || address,
      cached: true,
    };
  }

  const result = await googleMaps.geocodeAddress(address);
  const insert = await insertRecordWithOptionalScope(supabase, 'customer_geocodes', {
    customer_id: String(customer.id),
    address_hash: hash,
    lat: result.lat,
    lng: result.lng,
    formatted_address: result.formatted_address || address,
    geocoded_at: new Date().toISOString(),
  }, context);
  if (insert.error) throw insert.error;
  return {
    customer_id: String(customer.id),
    address_hash: hash,
    lat: numberOrNull(result.lat),
    lng: numberOrNull(result.lng),
    formatted_address: result.formatted_address || address,
    cached: false,
  };
}

async function readWarehouseGeocode(location, context) {
  const address = formatLocationAddress(location);
  if (!address) return null;
  const hash = addressHash(address);
  const { data, error } = await scopeQueryByContext(
    supabase.from('warehouse_geocodes').select('*'),
    context,
    { companyField: 'company_id' },
  )
    .eq('location_id', location.id)
    .eq('address_hash', hash)
    .limit(1);
  if (error) throw error;
  return firstScoped(data, context);
}

async function geocodeWarehouse(location, context) {
  const address = formatLocationAddress(location);
  if (!address) {
    const error = new Error('Missing warehouse address');
    error.status = 400;
    error.code = 'MISSING_WAREHOUSE_ADDRESS';
    throw error;
  }
  const hash = addressHash(address);
  const cached = await readWarehouseGeocode(location, context);
  if (cached) {
    return {
      location_id: String(location.id),
      address_hash: hash,
      lat: numberOrNull(cached.lat),
      lng: numberOrNull(cached.lng),
      formatted_address: cached.formatted_address || address,
      cached: true,
    };
  }
  const result = await googleMaps.geocodeAddress(address);
  const insert = await supabase.from('warehouse_geocodes').insert([{
    company_id: context.activeCompanyId || context.companyId,
    location_id: location.id,
    address_hash: hash,
    lat: result.lat,
    lng: result.lng,
    formatted_address: result.formatted_address || address,
    geocoded_at: new Date().toISOString(),
  }]).select().single();
  if (insert.error) throw insert.error;
  return {
    location_id: String(location.id),
    address_hash: hash,
    lat: numberOrNull(result.lat),
    lng: numberOrNull(result.lng),
    formatted_address: result.formatted_address || address,
    cached: false,
  };
}

async function readDriveTimeCache(originHash, destinationHash, mode, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('route_drive_time_cache').select('*'),
    context,
    { companyField: 'company_id' },
  )
    .eq('origin_hash', originHash)
    .eq('destination_hash', destinationHash)
    .eq('travel_mode', mode)
    .eq('day_bucket', todayBucket())
    .limit(1);
  if (error) throw error;
  return firstScoped(data, context);
}

async function writeDriveTimeCache(originHash, destinationHash, mode, element, context) {
  const duration = Number(element?.duration?.value ?? element?.duration_seconds);
  const distance = Number(element?.distance?.value ?? element?.distance_meters);
  if (!Number.isFinite(duration) || !Number.isFinite(distance)) {
    const error = new Error('Drive time unavailable for this route');
    error.status = 400;
    error.code = 'DRIVE_TIME_UNAVAILABLE';
    throw error;
  }
  const result = await insertRecordWithOptionalScope(supabase, 'route_drive_time_cache', {
    origin_hash: originHash,
    destination_hash: destinationHash,
    travel_mode: mode,
    day_bucket: todayBucket(),
    duration_seconds: Math.round(duration),
    distance_meters: Math.round(distance),
    cached_at: new Date().toISOString(),
  }, context);
  if (result.error) throw result.error;
  return result.data;
}

async function resolveCustomerLocation(customerId, context) {
  const customer = await loadCustomer(customerId, context);
  if (!customer) {
    const error = new Error('Customer not found');
    error.status = 404;
    throw error;
  }
  return geocodeCustomer(customer, context);
}

router.post('/geocode-customer/:customerId', authenticateToken, managerMapsRoles, validateParams(customerParamsSchema), async (req, res) => {
  try {
    const location = await resolveCustomerLocation(req.validated.params.customerId, req.context);
    const { address_hash: _addressHash, ...response } = location;
    res.json(response);
  } catch (error) {
    sendMapsError(res, error, 'Failed to geocode customer');
  }
});

router.get('/drive-time', authenticateToken, managerMapsRoles, validateQuery(driveTimeQuerySchema), async (req, res) => {
  try {
    const { from, to, mode } = req.validated.query;
    const [location, customer] = await Promise.all([
      loadLocation(from, req.context),
      loadCustomer(to, req.context),
    ]);
    if (!location) return res.status(404).json({ error: 'Warehouse location not found' });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const warehouse = await geocodeWarehouse(location, req.context);
    const customerLocation = await geocodeCustomer(customer, req.context);
    const cached = await readDriveTimeCache(warehouse.address_hash, customerLocation.address_hash, mode, req.context);
    if (cached) {
      return res.json({
        duration_seconds: cached.duration_seconds,
        distance_meters: cached.distance_meters,
        cached: true,
      });
    }

    const matrix = await googleMaps.getDistanceMatrix(
      [{ lat: warehouse.lat, lng: warehouse.lng }],
      [{ lat: customerLocation.lat, lng: customerLocation.lng }],
      mode,
    );
    const element = matrix?.rows?.[0]?.elements?.[0];
    if (element?.status && element.status !== 'OK') {
      const error = new Error(element.status === 'ZERO_RESULTS' ? 'Drive time unavailable for this route' : `Google Distance Matrix failed: ${element.status}`);
      error.status = element.status === 'ZERO_RESULTS' ? 400 : 502;
      error.code = element.status === 'ZERO_RESULTS' ? 'DRIVE_TIME_UNAVAILABLE' : 'MAPS_STATUS_ERROR';
      throw error;
    }
    const written = await writeDriveTimeCache(warehouse.address_hash, customerLocation.address_hash, mode, element, req.context);
    res.json({
      duration_seconds: written.duration_seconds,
      distance_meters: written.distance_meters,
      cached: false,
    });
  } catch (error) {
    sendMapsError(res, error, 'Failed to load drive time');
  }
});

router.get('/route/:routeId', authenticateToken, routeMapsRoles, validateParams(routeParamsSchema), async (req, res) => {
  try {
    const { data: route, error: routeError } = await scopeQueryByContext(
      supabase.from('routes').select('*'),
      req.context,
    )
      .eq('id', req.validated.params.routeId)
      .single();
    if (routeError || !route || !rowMatchesContext(route, req.context)) {
      return res.status(404).json({ error: 'Route not found' });
    }
    if (req.user.role === 'driver' && !isRouteAssignedToUser(route, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const stopIds = Array.isArray(route.active_stop_ids) && route.active_stop_ids.length
      ? route.active_stop_ids
      : (Array.isArray(route.stop_ids) ? route.stop_ids : []);
    const { data: stops, error: stopsError } = await scopeQueryByContext(
      supabase.from('stops').select('id,name,address,lat,lng,route_id,company_id,location_id'),
      req.context,
    )
      .in('id', stopIds);
    if (stopsError) throw stopsError;
    const scopedStops = filterRowsByContext(stops || [], req.context);
    const waypoints = googleMaps.buildRouteWaypointLatLngs(route, scopedStops);
    const directions = await googleMaps.getDirections(route.id, waypoints);
    const durationByStop = new Map((directions.legs || []).map((leg) => [String(leg.stop_id), leg]));

    res.json({
      route_id: route.id,
      encoded_polyline: directions.encoded_polyline || null,
      stops: waypoints.map((point) => {
        const leg = durationByStop.get(String(point.stop_id));
        return {
          ...point,
          duration_seconds: leg?.duration_seconds ?? null,
          distance_meters: leg?.distance_meters ?? null,
        };
      }),
    });
  } catch (error) {
    sendMapsError(res, error, 'Failed to load route map');
  }
});

router.resolveCustomerLocation = resolveCustomerLocation;
router._private = {
  addressHash,
  formatCustomerAddress,
  formatLocationAddress,
};

module.exports = router;
