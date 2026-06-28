'use strict';

const crypto = require('node:crypto');
const config = require('../lib/config');
const { buildScopeFields, scopeQueryByContext } = require('./operating-context');
const { supabase } = require('./supabase');

const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api';
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_STATUS = new Set(['OVER_QUERY_LIMIT', 'UNKNOWN_ERROR']);

function normalizeAddress(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hashAddress(value) {
  return crypto.createHash('sha256').update(normalizeAddress(value).toLowerCase()).digest('hex');
}

function hashLatLng(value) {
  if (!value) return '';
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return hashAddress(JSON.stringify(value));
  return crypto.createHash('sha256').update(`${lat.toFixed(6)},${lng.toFixed(6)}`).digest('hex');
}

function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapsError(message, { code = 'MAPS_ERROR', status = 502, mapsStatus = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.mapsStatus = mapsStatus;
  return error;
}

function apiKey() {
  return config.GOOGLE_MAPS_API_KEY || config.GOOGLE_MAPS_KEY;
}

function assertApiKey() {
  const key = apiKey();
  if (!key) {
    throw mapsError('GOOGLE_MAPS_API_KEY is not configured on the server', {
      code: 'MAPS_KEY_MISSING',
      status: 503,
    });
  }
  return key;
}

function errorForGoogleStatus(status, fallback = 'Google Maps request failed') {
  if (status === 'OVER_QUERY_LIMIT') {
    return mapsError('Google Maps quota exceeded', { code: 'QUOTA_EXCEEDED', status: 429, mapsStatus: status });
  }
  if (status === 'ZERO_RESULTS' || status === 'NOT_FOUND' || status === 'INVALID_REQUEST') {
    return mapsError('Invalid or unresolved map address', { code: 'INVALID_ADDRESS', status: 400, mapsStatus: status });
  }
  if (status && status !== 'OK') {
    return mapsError(`${fallback}: ${status}`, { code: 'MAPS_STATUS_ERROR', status: 502, mapsStatus: status });
  }
  return null;
}

async function fetchJsonWithBackoff(url, { maxAttempts = 4, initialDelayMs = 250 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url.toString());
      const body = await response.json().catch(() => ({}));
      const status = body?.status;
      if (response.ok && !RETRYABLE_STATUS.has(status)) {
        const statusError = errorForGoogleStatus(status);
        if (statusError) throw statusError;
        return body;
      }
      if (!RETRYABLE_HTTP.has(response.status) && !RETRYABLE_STATUS.has(status)) {
        throw mapsError(`Google Maps HTTP ${response.status}`, {
          code: 'MAPS_HTTP_ERROR',
          status: response.status >= 400 && response.status < 500 ? response.status : 502,
          mapsStatus: status || null,
        });
      }
      lastError = errorForGoogleStatus(status) || mapsError(`Google Maps HTTP ${response.status}`, {
        code: response.status === 429 ? 'QUOTA_EXCEEDED' : 'MAPS_RETRYABLE',
        status: response.status === 429 ? 429 : 502,
        mapsStatus: status || null,
      });
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_STATUS.has(error.mapsStatus) && error.code !== 'QUOTA_EXCEEDED' && error.status < 500) {
        throw error;
      }
    }
    if (attempt < maxAttempts - 1) {
      await wait(initialDelayMs * (2 ** attempt));
    }
  }
  throw lastError || mapsError('Google Maps request failed after retries');
}

async function readGeocodeCache({ table, ownerField, ownerId, addressHash, context, locationScoped = false }) {
  if (!table || !ownerField || !ownerId || !addressHash || !context) return null;
  const { data, error } = await scopeQueryByContext(
    supabase.from(table).select('*'),
    context,
    { companyField: 'company_id', includeLocation: locationScoped },
  )
    .eq(ownerField, ownerId)
    .eq('address_hash', addressHash)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function writeGeocodeCache({ table, record, context }) {
  if (!table || !record || !context) return null;
  const { data, error } = await supabase
    .from(table)
    .insert([{ ...buildScopeFields(context), ...record }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function geocodeAddress(address, options = {}) {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    throw mapsError('Invalid customer address', { code: 'INVALID_ADDRESS', status: 400 });
  }
  const addressHash = hashAddress(normalized);
  if (options.cacheTable && options.ownerField && options.ownerId && options.context) {
    const cached = await readGeocodeCache({
      table: options.cacheTable,
      ownerField: options.ownerField,
      ownerId: options.ownerId,
      addressHash,
      context: options.context,
      locationScoped: options.locationScoped,
    });
    if (cached) {
      return {
        lat: Number(cached.lat),
        lng: Number(cached.lng),
        formatted_address: cached.formatted_address || normalized,
        address_hash: addressHash,
        cached: true,
      };
    }
  }

  const url = new URL(`${GOOGLE_BASE}/geocode/json`);
  url.searchParams.set('address', normalized);
  url.searchParams.set('key', assertApiKey());
  const body = await fetchJsonWithBackoff(url);
  const first = body.results?.[0];
  const location = first?.geometry?.location;
  if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) {
    throw mapsError('Invalid or unresolved map address', { code: 'INVALID_ADDRESS', status: 400, mapsStatus: body.status || null });
  }
  const result = {
    lat: Number(location.lat),
    lng: Number(location.lng),
    formatted_address: first.formatted_address || normalized,
    address_hash: addressHash,
    cached: false,
  };

  if (options.cacheTable && options.ownerField && options.ownerId && options.context) {
    await writeGeocodeCache({
      table: options.cacheTable,
      context: options.context,
      record: {
        [options.ownerField]: options.ownerId,
        address_hash: addressHash,
        lat: result.lat,
        lng: result.lng,
        formatted_address: result.formatted_address,
        geocoded_at: new Date().toISOString(),
      },
    });
  }

  return result;
}

function serializeLatLngList(points) {
  return points.map((point) => `${Number(point.lat)},${Number(point.lng)}`).join('|');
}

function dayBucket(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function readDriveTimeCache({ originHash, destinationHash, mode, bucket, context }) {
  if (!context) return null;
  const { data, error } = await scopeQueryByContext(
    supabase.from('route_drive_time_cache').select('*'),
    context,
    { companyField: 'company_id', includeLocation: true },
  )
    .eq('origin_hash', originHash)
    .eq('destination_hash', destinationHash)
    .eq('travel_mode', mode)
    .eq('day_bucket', bucket)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function writeDriveTimeCache({ originHash, destinationHash, mode, bucket, element, context, routeId = null }) {
  if (!context || !element) return null;
  const duration = Number(element.duration?.value ?? element.duration_seconds);
  const distance = Number(element.distance?.value ?? element.distance_meters);
  if (!Number.isFinite(duration) || !Number.isFinite(distance)) return null;
  const { data, error } = await supabase
    .from('route_drive_time_cache')
    .insert([{
      ...buildScopeFields(context),
      route_id: routeId,
      origin_hash: originHash,
      destination_hash: destinationHash,
      travel_mode: mode,
      day_bucket: bucket,
      duration_seconds: Math.round(duration),
      distance_meters: Math.round(distance),
      cached_at: new Date().toISOString(),
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getDistanceMatrix(origins, destinations, mode = 'driving', options = {}) {
  if (!Array.isArray(origins) || !origins.length || !Array.isArray(destinations) || !destinations.length) {
    throw mapsError('Distance Matrix requires at least one origin and destination', { code: 'INVALID_DISTANCE_INPUT', status: 400 });
  }
  const travelMode = String(mode || 'driving').toLowerCase();
  const originHash = options.originHash || hashAddress(serializeLatLngList(origins));
  const destinationHash = options.destinationHash || hashAddress(serializeLatLngList(destinations));
  const bucket = options.dayBucket || dayBucket();

  if (options.context && origins.length === 1 && destinations.length === 1) {
    const cached = await readDriveTimeCache({ originHash, destinationHash, mode: travelMode, bucket, context: options.context });
    if (cached) {
      return {
        rows: [{
          elements: [{
            status: 'OK',
            duration: { value: cached.duration_seconds },
            distance: { value: cached.distance_meters },
            cached: true,
          }],
        }],
        cached: true,
      };
    }
  }

  const url = new URL(`${GOOGLE_BASE}/distancematrix/json`);
  url.searchParams.set('origins', serializeLatLngList(origins));
  url.searchParams.set('destinations', serializeLatLngList(destinations));
  url.searchParams.set('mode', travelMode);
  url.searchParams.set('key', assertApiKey());
  const body = await fetchJsonWithBackoff(url);
  const element = body.rows?.[0]?.elements?.[0];
  const elementError = errorForGoogleStatus(element?.status, 'Google Distance Matrix element failed');
  if (elementError) throw elementError;
  if (options.context && origins.length === 1 && destinations.length === 1) {
    await writeDriveTimeCache({
      originHash,
      destinationHash,
      mode: travelMode,
      bucket,
      element,
      context: options.context,
      routeId: options.routeId || null,
    });
  }
  return { ...body, cached: false };
}

function buildRouteWaypointLatLngs(route, stops) {
  const byId = new Map((stops || []).map((stop) => [String(stop.id), stop]));
  const orderedIds = Array.isArray(route?.active_stop_ids) && route.active_stop_ids.length
    ? route.active_stop_ids
    : (Array.isArray(route?.stop_ids) ? route.stop_ids : []);
  return orderedIds
    .map((id) => byId.get(String(id)))
    .filter((stop) => toFiniteNumber(stop?.lat) !== null && toFiniteNumber(stop?.lng) !== null)
    .map((stop, index) => ({
      stop_id: String(stop.id),
      sequence: index + 1,
      lat: toFiniteNumber(stop.lat),
      lng: toFiniteNumber(stop.lng),
      name: stop.name || '',
      address: stop.address || '',
    }));
}

async function getDirections(routeId, waypointLatLngs = []) {
  if (!routeId) throw mapsError('routeId is required', { code: 'INVALID_ROUTE', status: 400 });
  if (!Array.isArray(waypointLatLngs) || waypointLatLngs.length < 2) {
    return { encoded_polyline: null, legs: [] };
  }
  const [origin] = waypointLatLngs;
  const destination = waypointLatLngs[waypointLatLngs.length - 1];
  const middle = waypointLatLngs.slice(1, -1);
  const url = new URL(`${GOOGLE_BASE}/directions/json`);
  url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
  url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
  if (middle.length) {
    url.searchParams.set('waypoints', middle.map((point) => `${point.lat},${point.lng}`).join('|'));
  }
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', assertApiKey());
  const body = await fetchJsonWithBackoff(url);
  const route = body.routes?.[0];
  return {
    encoded_polyline: route?.overview_polyline?.points || null,
    legs: (route?.legs || []).map((leg, index) => ({
      from_stop_id: waypointLatLngs[index]?.stop_id || null,
      stop_id: waypointLatLngs[index + 1]?.stop_id || null,
      sequence: waypointLatLngs[index + 1]?.sequence || index + 1,
      duration_seconds: Number(leg.duration?.value || 0),
      distance_meters: Number(leg.distance?.value || 0),
    })),
  };
}

async function invalidateRouteDriveTimeCache(routeId, context) {
  if (!routeId) return;
  let query = supabase.from('route_drive_time_cache').delete().eq('route_id', routeId);
  query = scopeQueryByContext(query, context, { companyField: 'company_id', includeLocation: true });
  const { error } = await query;
  if (error) throw error;
}

module.exports = {
  dayBucket,
  geocodeAddress,
  getDirections,
  getDistanceMatrix,
  hashAddress,
  hashLatLng,
  invalidateRouteDriveTimeCache,
  mapsError,
  normalizeAddress,
  buildRouteWaypointLatLngs,
};
