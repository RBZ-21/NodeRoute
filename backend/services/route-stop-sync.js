const {
  executeWithOptionalScope,
  insertRecordWithOptionalScope,
} = require('./operating-context');

function normalizeIdArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index);
  }
  return [];
}

function buildRouteStopPlan(routeId, stopIds, activeStopIds) {
  const assignedStopIds = normalizeIdArray(stopIds);
  const activeSelection = normalizeIdArray(activeStopIds).filter((stopId) => assignedStopIds.includes(stopId));
  const sequencedStopIds = activeSelection.length ? activeSelection : assignedStopIds;
  const sequenceMap = new Map(sequencedStopIds.map((stopId, index) => [stopId, index + 1]));

  return {
    routeId: routeId == null ? null : String(routeId),
    assignedStopIds,
    activeStopIds: activeSelection,
    sequencedStopIds,
    sequenceMap,
  };
}

function buildRouteMutationAuditEntry({
  routeId,
  action,
  actor = {},
  beforeStopIds = [],
  afterStopIds = [],
  beforeActiveStopIds = [],
  afterActiveStopIds = [],
  metadata = {},
}) {
  return {
    route_id: routeId == null ? null : String(routeId),
    action: String(action || 'update'),
    actor_user_id: actor.id ? String(actor.id) : null,
    actor_email: actor.email ? String(actor.email) : null,
    actor_role: actor.role ? String(actor.role) : null,
    before_stop_ids: normalizeIdArray(beforeStopIds),
    after_stop_ids: normalizeIdArray(afterStopIds),
    before_active_stop_ids: normalizeIdArray(beforeActiveStopIds),
    after_active_stop_ids: normalizeIdArray(afterActiveStopIds),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };
}

function isMissingRelationError(error, relationName) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('does not exist') && message.includes(String(relationName || '').toLowerCase());
}

async function fetchRouteRecord(supabase, routeId) {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .eq('id', routeId)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

async function insertRouteMutationAuditEntry(supabase, context, entry) {
  try {
    const result = await insertRecordWithOptionalScope(supabase, 'route_mutation_audit_logs', entry, context || {});
    if (result.error && isMissingRelationError(result.error, 'route_mutation_audit_logs')) {
      return { data: null, error: null };
    }
    return result;
  } catch (error) {
    if (isMissingRelationError(error, 'route_mutation_audit_logs')) {
      return { data: null, error: null };
    }
    return { data: null, error };
  }
}

async function synchronizeRouteStopAssignments(supabase, routeId, stopIds, activeStopIds) {
  const plan = buildRouteStopPlan(routeId, stopIds, activeStopIds);
  const currentAssignedResult = await supabase
    .from('stops')
    .select('id, route_id, stop_seq')
    .eq('route_id', routeId);

  if (currentAssignedResult.error) return { error: currentAssignedResult.error };

  const currentAssignedStops = Array.isArray(currentAssignedResult.data) ? currentAssignedResult.data : [];
  const currentAssignedIds = currentAssignedStops.map((stop) => String(stop.id));
  const finalAssignmentIds = [...new Set([...currentAssignedIds, ...plan.assignedStopIds])];

  const temporarySequenceIds = currentAssignedStops
    .filter((stop) => stop.stop_seq != null && plan.sequenceMap.has(String(stop.id)))
    .map((stop) => String(stop.id));

  for (let index = 0; index < temporarySequenceIds.length; index += 1) {
    const stopId = temporarySequenceIds[index];
    const tempResult = await supabase
      .from('stops')
      .update({ stop_seq: -1 * (index + 1) })
      .eq('id', stopId)
      .select('id')
      .single();

    if (tempResult.error) return { error: tempResult.error };
  }

  for (const stopId of finalAssignmentIds) {
    const shouldRemainAssigned = plan.assignedStopIds.includes(stopId);
    const payload = shouldRemainAssigned
      ? {
          route_id: routeId,
          stop_seq: plan.sequenceMap.get(stopId) ?? null,
        }
      : {
          route_id: null,
          stop_seq: null,
        };

    const updateResult = await supabase
      .from('stops')
      .update(payload)
      .eq('id', stopId)
      .select('id')
      .single();

    if (updateResult.error) return { error: updateResult.error };
  }

  return { error: null, plan };
}

async function syncRouteMutation(supabase, {
  routeId,
  stopIds,
  activeStopIds,
  action,
  actor,
  context,
  metadata,
}) {
  const routeResult = await fetchRouteRecord(supabase, routeId);
  if (routeResult.error) return routeResult;
  const existingRoute = routeResult.data;
  if (!existingRoute) return { data: null, error: new Error('Route not found') };

  const plan = buildRouteStopPlan(
    routeId,
    stopIds !== undefined ? stopIds : existingRoute.stop_ids,
    activeStopIds !== undefined ? activeStopIds : existingRoute.active_stop_ids
  );

  const routePayload = {
    stop_ids: plan.assignedStopIds,
    active_stop_ids: plan.activeStopIds.length ? plan.activeStopIds : plan.assignedStopIds,
  };

  const routeUpdate = await executeWithOptionalScope(
    (candidate) => supabase.from('routes').update(candidate).eq('id', routeId).select().single(),
    routePayload
  );
  if (routeUpdate.error) return { data: null, error: routeUpdate.error };

  const syncResult = await synchronizeRouteStopAssignments(
    supabase,
    routeId,
    plan.assignedStopIds,
    routePayload.active_stop_ids
  );
  if (syncResult.error) return { data: null, error: syncResult.error };

  const auditResult = await insertRouteMutationAuditEntry(
    supabase,
    context,
    buildRouteMutationAuditEntry({
      routeId,
      action,
      actor,
      beforeStopIds: existingRoute.stop_ids,
      afterStopIds: plan.assignedStopIds,
      beforeActiveStopIds: existingRoute.active_stop_ids,
      afterActiveStopIds: routePayload.active_stop_ids,
      metadata,
    })
  );
  if (auditResult.error) return { data: null, error: auditResult.error };

  return fetchRouteRecord(supabase, routeId);
}

async function logRouteMutation(supabase, {
  routeId,
  action,
  actor,
  context,
  beforeStopIds,
  afterStopIds,
  beforeActiveStopIds,
  afterActiveStopIds,
  metadata,
}) {
  const auditResult = await insertRouteMutationAuditEntry(
    supabase,
    context,
    buildRouteMutationAuditEntry({
      routeId,
      action,
      actor,
      beforeStopIds,
      afterStopIds,
      beforeActiveStopIds,
      afterActiveStopIds,
      metadata,
    })
  );

  return auditResult.error ? { data: null, error: auditResult.error } : { data: auditResult.data, error: null };
}

module.exports = {
  buildRouteMutationAuditEntry,
  buildRouteStopPlan,
  logRouteMutation,
  normalizeIdArray,
  syncRouteMutation,
};
