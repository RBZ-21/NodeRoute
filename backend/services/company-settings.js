const { supabase } = require('./supabase');

const DEFAULT_BUSINESS_NAME = 'NodeRoute Systems';
const MAX_LOGO_DATA_URL_LENGTH = 1_500_000;

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
    businessName,
    invoiceLogoDataUrl: normalizeLogoDataUrl(
      source.invoice_logo_data_url
      || source.invoiceLogoDataUrl
      || source.logo_data_url
      || source.logoDataUrl
    ),
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

module.exports = {
  DEFAULT_BUSINESS_NAME,
  MAX_LOGO_DATA_URL_LENGTH,
  loadCompanySettings,
  normalizeCompanySettings,
  normalizeLogoDataUrl,
};
