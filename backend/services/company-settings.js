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

function boundedString(value, maxLength) {
  return normalizeString(value).slice(0, maxLength);
}

function companyProfileAddress(profile = {}) {
  const cityLine = [
    normalizeString(profile.city),
    [normalizeString(profile.state), normalizeString(profile.zip)].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  return [normalizeString(profile.address), cityLine].filter(Boolean).join('\n');
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

function normalizeCompanySettings(settings, fallbackBusinessName = '', profile = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const profileAddress = companyProfileAddress(profile);
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
    invoiceAddress: boundedString(
      source.invoice_address ?? source.invoiceAddress ?? profileAddress,
      500,
    ),
    invoicePhone: boundedString(
      source.invoice_phone ?? source.invoicePhone ?? profile.phone,
      200,
    ),
    invoiceFax: boundedString(source.invoice_fax ?? source.invoiceFax, 200),
    invoiceAfterHoursPhone: boundedString(
      source.invoice_after_hours_phone ?? source.invoiceAfterHoursPhone,
      200,
    ),
    invoiceRemitTo: boundedString(
      source.invoice_remit_to ?? source.invoiceRemitTo ?? profileAddress,
      500,
    ),
    invoiceSalesTerms: boundedString(
      source.invoice_sales_terms ?? source.invoiceSalesTerms,
      4000,
    ),
    invoiceCreditTerms: boundedString(
      source.invoice_credit_terms ?? source.invoiceCreditTerms,
      4000,
    ),
    invoiceCopyLabel: boundedString(
      source.invoice_copy_label ?? source.invoiceCopyLabel,
      200,
    ),
    invoiceSafetyNotice: boundedString(
      source.invoice_safety_notice ?? source.invoiceSafetyNotice,
      200,
    ),
  };
}

async function loadCompanySettings(companyId, fallbackBusinessName = '') {
  if (!companyId) {
    return normalizeCompanySettings({}, fallbackBusinessName);
  }

  const { data, error } = await supabase
    .from('companies')
    .select('name,phone,address,city,state,zip,settings')
    .eq('id', companyId)
    .single();

  if (error) {
    return normalizeCompanySettings({}, fallbackBusinessName);
  }

  return normalizeCompanySettings(data?.settings, fallbackBusinessName || data?.name, data);
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
  boundedString,
  companyProfileAddress,
  normalizeLogoDataUrl,
  normalizeCutoffHour,
  normalizeCutoffDay,
  computeCutoffTimestamp,
};
