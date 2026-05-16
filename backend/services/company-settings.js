'use strict';

const { supabase } = require('./supabase');

const DEFAULT_BUSINESS_NAME = 'NodeRoute Systems';
const MAX_LOGO_DATA_URL_LENGTH = 1_500_000;

// Valid hour options for the order cutoff time picker (12-hour labels, 24-hour values)
const CUTOFF_HOUR_OPTIONS = [
  { label: '8:00 AM',  value: 8  },
  { label: '9:00 AM',  value: 9  },
  { label: '10:00 AM', value: 10 },
  { label: '11:00 AM', value: 11 },
  { label: '12:00 PM', value: 12 },
  { label: '1:00 PM',  value: 13 },
  { label: '2:00 PM',  value: 14 },
  { label: '3:00 PM',  value: 15 },
  { label: '4:00 PM',  value: 16 },
  { label: '5:00 PM',  value: 17 },
  { label: '6:00 PM',  value: 18 },
];

// 'day_of'     = cutoff is on the same day as the delivery
// 'day_before' = cutoff is the day before the delivery
const CUTOFF_DAY_OPTIONS = [
  { label: 'Day of delivery',      value: 'day_of'     },
  { label: 'Day before delivery',  value: 'day_before' },
];

const DEFAULT_CUTOFF_HOUR = 14;       // 2:00 PM
const DEFAULT_CUTOFF_DAY  = 'day_of'; // same day

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeLogoDataUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  if (!/^data:image\/(png|jpeg|jpg);base64,/i.test(raw)) return null;
  if (raw.length > MAX_LOGO_DATA_URL_LENGTH) return null;
  return raw;
}

function normalizeCutoffHour(value) {
  const n = parseInt(value, 10);
  const valid = CUTOFF_HOUR_OPTIONS.map((o) => o.value);
  return valid.includes(n) ? n : DEFAULT_CUTOFF_HOUR;
}

function normalizeCutoffDay(value) {
  const valid = CUTOFF_DAY_OPTIONS.map((o) => o.value);
  return valid.includes(value) ? value : DEFAULT_CUTOFF_DAY;
}

function normalizeCompanySettings(settings, fallbackBusinessName = '') {
  const source = settings && typeof settings === 'object' ? settings : {};
  const businessName = normalizeString(
    source.business_name
    || source.businessName
    || fallbackBusinessName
    || DEFAULT_BUSINESS_NAME
  );

  return {
    forceDriverSignature: !!(source.force_driver_signature || source.forceDriverSignature),
    forceDriverProofOfDelivery: !!(source.force_driver_proof_of_delivery || source.forceDriverProofOfDelivery),
    businessName,
    invoiceLogoDataUrl: normalizeLogoDataUrl(
      source.invoice_logo_data_url
      || source.invoiceLogoDataUrl
      || source.logo_data_url
      || source.logoDataUrl
    ),
    // Order cutoff
    orderCutoffHour: normalizeCutoffHour(source.order_cutoff_hour ?? source.orderCutoffHour),
    orderCutoffDay:  normalizeCutoffDay(source.order_cutoff_day  ?? source.orderCutoffDay),
  };
}

async function loadCompanySettings(companyId, fallbackBusinessName = '') {
  if (!companyId) {
    return normalizeCompanySettings({}, fallbackBusinessName);
  }

  const { data, error } = await supabase
    .from('companies')
    .select('settings')
    .eq('id', companyId)
    .single();

  if (error) {
    return normalizeCompanySettings({}, fallbackBusinessName);
  }

  return normalizeCompanySettings(data?.settings, fallbackBusinessName);
}

/**
 * Compute the cutoff ISO timestamp for the daily fish blast.
 *
 * Given a delivery date (today by default), returns the moment orders
 * stop being accepted — used to determine which inventory receipts to
 * include in the morning SMS.
 *
 * @param {object} settings  - normalised company settings
 * @param {Date}   [now]     - reference date (defaults to now)
 * @returns {string}         - ISO 8601 timestamp of the cutoff
 */
function computeCutoffTimestamp(settings, now = new Date()) {
  const hour = settings?.orderCutoffHour ?? DEFAULT_CUTOFF_HOUR;
  const day  = settings?.orderCutoffDay  ?? DEFAULT_CUTOFF_DAY;

  const cutoff = new Date(now);

  if (day === 'day_before') {
    // Cutoff was yesterday at <hour>:00
    cutoff.setDate(cutoff.getDate() - 1);
  }
  // else: day_of — same calendar day

  cutoff.setHours(hour, 0, 0, 0);
  return cutoff.toISOString();
}

module.exports = {
  DEFAULT_BUSINESS_NAME,
  MAX_LOGO_DATA_URL_LENGTH,
  CUTOFF_HOUR_OPTIONS,
  CUTOFF_DAY_OPTIONS,
  DEFAULT_CUTOFF_HOUR,
  DEFAULT_CUTOFF_DAY,
  loadCompanySettings,
  normalizeCompanySettings,
  normalizeLogoDataUrl,
  normalizeCutoffHour,
  normalizeCutoffDay,
  computeCutoffTimestamp,
};
