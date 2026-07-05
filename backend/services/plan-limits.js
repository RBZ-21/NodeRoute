'use strict';

const PLAN_LIMITS = {
  trial: { maxDrivers: 2, maxDeliveriesPerMonth: 500 },
  track: { maxDrivers: 2, maxDeliveriesPerMonth: 500 },
  dispatch: { maxDrivers: 5, maxDeliveriesPerMonth: 2500 },
  operations: { maxDrivers: 10, maxDeliveriesPerMonth: 5000 },
  erp: { maxDrivers: 15, maxDeliveriesPerMonth: 10000 },
  enterprise: { maxDrivers: 25, maxDeliveriesPerMonth: 20000 },
};

const LEGACY_PLAN_ALIASES = {
  free: 'track',
  starter: 'track',
  growth: 'operations',
  pro: 'erp',
};

function currentCompanyId(context) {
  return String(context?.activeCompanyId || context?.companyId || '').trim();
}

function planLimitError(message, details) {
  const error = new Error(message);
  error.status = 402;
  error.code = 'PLAN_LIMIT_EXCEEDED';
  error.details = details;
  return error;
}

function planLimitsFor(company) {
  const rawPlan = String(company?.plan || company?.subscription_plan || 'track').toLowerCase();
  const plan = LEGACY_PLAN_ALIASES[rawPlan] || rawPlan;
  return { plan, ...(PLAN_LIMITS[plan] || PLAN_LIMITS.track) };
}

async function loadCompanyPlan(supabase, companyId) {
  const { data, error } = await supabase
    .from('companies')
    .select('id, plan, status')
    .eq('id', companyId)
    .single();
  if (error) throw error;
  return planLimitsFor(data);
}

async function enforceDriverLimit(supabase, context) {
  const companyId = currentCompanyId(context);
  if (!companyId) return;
  const limits = await loadCompanyPlan(supabase, companyId);
  if (!Number.isFinite(limits.maxDrivers)) return;

  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('role', 'driver')
    .in('status', ['active', 'pending']);
  if (error) throw error;
  if ((count || 0) >= limits.maxDrivers) {
    throw planLimitError('Driver limit reached for current plan', {
      companyId,
      plan: limits.plan,
      limit: limits.maxDrivers,
      current: count || 0,
    });
  }
}

async function enforceDeliveryLimit(supabase, context) {
  const companyId = currentCompanyId(context);
  if (!companyId) return;
  const limits = await loadCompanyPlan(supabase, companyId);
  if (!Number.isFinite(limits.maxDeliveriesPerMonth)) return;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('created_at', monthStart.toISOString());
  if (error) throw error;
  if ((count || 0) >= limits.maxDeliveriesPerMonth) {
    throw planLimitError('Monthly delivery limit reached for current plan', {
      companyId,
      plan: limits.plan,
      limit: limits.maxDeliveriesPerMonth,
      current: count || 0,
    });
  }
}

function sendPlanLimitError(res, error) {
  if (error?.code !== 'PLAN_LIMIT_EXCEEDED') return false;
  res.status(error.status || 402).json({
    error: error.code,
    message: error.message,
    details: error.details,
  });
  return true;
}

module.exports = {
  PLAN_LIMITS,
  enforceDeliveryLimit,
  enforceDriverLimit,
  planLimitsFor,
  sendPlanLimitError,
};
