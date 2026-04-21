const COMPANY_FIELD_CANDIDATES = ['company_id', 'organization_id', 'tenant_id', 'org_id'];
const COMPANY_NAME_FIELD_CANDIDATES = ['company_name', 'organization_name', 'tenant_name'];
const LOCATION_FIELD_CANDIDATES = ['location_id', 'site_id', 'warehouse_id'];
const LOCATION_NAME_FIELD_CANDIDATES = ['location_name', 'site_name', 'warehouse_name'];
const LOCATION_LIST_FIELD_CANDIDATES = ['location_ids', 'site_ids', 'warehouse_ids', 'accessible_location_ids'];
const PLATFORM_ROLE_CANDIDATES = ['platform_role', 'scope_role'];
const OPTIONAL_SCOPE_FIELDS = [
  'location_id',
  'location_name',
  'company_id',
  'company_name',
  'address',
  'tax_enabled',
  'tax_rate',
  'order_id',
  'invoice_id',
  'logged_at',
  'storage_area',
  'temperature',
  'unit',
  'check_type',
  'corrective_action',
  'initials',
  'recorded_by',
];
const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '00000000-0000-0000-0000-000000000001';
const DEFAULT_COMPANY_NAME = process.env.DEFAULT_COMPANY_NAME || 'Default Company';
const DEFAULT_LOCATION_ID = process.env.DEFAULT_LOCATION_ID || '00000000-0000-0000-0000-000000000101';
const DEFAULT_LOCATION_NAME = process.env.DEFAULT_LOCATION_NAME || 'Primary Location';

function firstValue(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }
  return null;
}

function normalizeId(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(normalizeId).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed).map(normalizeId).filter(Boolean);
      } catch {
        return trimmed.split(',').map(normalizeId).filter(Boolean);
      }
    }
    return trimmed.split(',').map(normalizeId).filter(Boolean);
  }
  return [];
}

function getUserOperatingContext(user) {
  const companyId = normalizeId(firstValue(user, COMPANY_FIELD_CANDIDATES) || DEFAULT_COMPANY_ID);
  const companyName = normalizeId(firstValue(user, COMPANY_NAME_FIELD_CANDIDATES) || DEFAULT_COMPANY_NAME);
  const baseLocationId = normalizeId(firstValue(user, LOCATION_FIELD_CANDIDATES) || DEFAULT_LOCATION_ID);
  const locationName = normalizeId(firstValue(user, LOCATION_NAME_FIELD_CANDIDATES) || DEFAULT_LOCATION_NAME);
  const platformRole = normalizeId(firstValue(user, PLATFORM_ROLE_CANDIDATES));
  const accessibleLocationIds = [
    ...parseIdList(firstValue(user, LOCATION_LIST_FIELD_CANDIDATES)),
    ...(baseLocationId ? [baseLocationId] : []),
  ].filter((value, index, all) => all.indexOf(value) === index);

  return {
    companyId,
    companyName,
    locationId: baseLocationId,
    locationName,
    accessibleLocationIds,
    platformRole,
    isGlobalOperator: ['platform_admin', 'super_admin'].includes(String(platformRole || '').toLowerCase()),
  };
}

function buildRequestContext(req, user) {
  const userContext = getUserOperatingContext(user);
  const requestedLocationId = normalizeId(
    req?.headers?.['x-location-id'] ||
    req?.query?.locationId ||
    req?.body?.locationId ||
    null
  );

  let activeLocationId = userContext.locationId;
  if (requestedLocationId) {
    const canUseRequestedLocation =
      userContext.isGlobalOperator ||
      !userContext.accessibleLocationIds.length ||
      userContext.accessibleLocationIds.includes(requestedLocationId);
    if (canUseRequestedLocation) activeLocationId = requestedLocationId;
  }

  return {
    ...userContext,
    requestedLocationId,
    activeLocationId,
  };
}

function userResponseWithContext(user) {
  const context = getUserOperatingContext(user);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    companyId: context.companyId,
    companyName: context.companyName,
    locationId: context.locationId,
    locationName: context.locationName,
    accessibleLocationIds: context.accessibleLocationIds,
    platformRole: context.platformRole,
  };
}

function extractRowCompanyId(row) {
  return normalizeId(firstValue(row, COMPANY_FIELD_CANDIDATES));
}

function extractRowLocationId(row) {
  return normalizeId(firstValue(row, LOCATION_FIELD_CANDIDATES));
}

function rowMatchesContext(row, context) {
  if (!row || !context || context.isGlobalOperator) return true;

  const rowCompanyId = extractRowCompanyId(row);
  const rowLocationId = extractRowLocationId(row);

  if (context.companyId && rowCompanyId && rowCompanyId !== context.companyId) return false;

  const allowedLocations = context.accessibleLocationIds || [];
  if (context.activeLocationId && rowLocationId && rowLocationId !== context.activeLocationId) return false;
  if (!context.activeLocationId && allowedLocations.length && rowLocationId && !allowedLocations.includes(rowLocationId)) return false;

  return true;
}

function filterRowsByContext(rows, context) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter((row) => rowMatchesContext(row, context));
}

function buildScopeFields(context, overrides = {}) {
  const scoped = { ...overrides };
  const companyId = normalizeId(overrides.company_id || overrides.companyId || context.companyId);
  const locationId = normalizeId(overrides.location_id || overrides.locationId || context.activeLocationId || context.locationId);

  if (companyId) scoped.company_id = companyId;
  if (locationId) scoped.location_id = locationId;
  return scoped;
}

function isMissingColumnError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('column') && message.includes('does not exist')
  ) || message.includes('schema cache');
}

function findMissingScopeField(error, record) {
  const message = String(error?.message || '').toLowerCase();
  for (const key of OPTIONAL_SCOPE_FIELDS) {
    if (record[key] !== undefined && message.includes(key)) {
      return key;
    }
  }

  return OPTIONAL_SCOPE_FIELDS.find((key) => record[key] !== undefined) || null;
}

async function executeWithOptionalScope(execute, record) {
  const candidate = { ...record };
  let result = await execute(candidate);

  while (result.error && isMissingColumnError(result.error)) {
    const missingField = findMissingScopeField(result.error, candidate);
    if (!missingField) break;
    delete candidate[missingField];
    result = await execute(candidate);
  }

  return result;
}

async function insertRecordWithOptionalScope(supabase, table, record, context) {
  const scopedRecord = { ...record, ...buildScopeFields(context) };
  return executeWithOptionalScope(
    (candidate) => supabase.from(table).insert([candidate]).select().single(),
    scopedRecord
  );
}

module.exports = {
  buildRequestContext,
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  getUserOperatingContext,
  insertRecordWithOptionalScope,
  isMissingColumnError,
  rowMatchesContext,
  userResponseWithContext,
};
