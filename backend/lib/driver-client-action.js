'use strict';

const { supabase } = require('../services/supabase');

const CLIENT_ACTION_RE = /^[A-Za-z0-9_-]{8,64}$/;

function readClientActionId(req) {
  const header = String(req.headers['x-client-action-id'] || '').trim();
  if (header && CLIENT_ACTION_RE.test(header)) return header;
  const body = String(req.body?.client_action_id || '').trim();
  if (body && CLIENT_ACTION_RE.test(body)) return body;
  return null;
}

async function findDriverClientAction(req) {
  const clientActionId = readClientActionId(req);
  if (!clientActionId || !req.user?.id) return { duplicate: false, clientActionId: null };

  const { data, error } = await supabase
    .from('driver_client_actions')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('client_action_id', clientActionId)
    .limit(1);

  if (error) {
    const err = new Error('Failed to check client action');
    err.cause = error;
    throw err;
  }

  return { duplicate: Array.isArray(data) && data.length > 0, clientActionId };
}

/**
 * Record a driver client action id after the associated mutation succeeds.
 * Recording is best-effort: never turn a committed write into a retryable 500.
 */
async function recordDriverClientAction(req, { actionType, resourceId = null }) {
  const clientActionId = readClientActionId(req);
  if (!clientActionId || !req.user?.id) return { recorded: false, duplicate: false, clientActionId: null };

  const { error } = await supabase.from('driver_client_actions').insert({
    user_id: req.user.id,
    client_action_id: clientActionId,
    action_type: actionType,
    resource_id: resourceId ? String(resourceId) : null,
  });

  if (error?.code === '23505') {
    return { recorded: false, duplicate: true, clientActionId };
  }
  if (error) {
    console.error('[driver-client-action] failed to record action:', error.message || error);
    return { recorded: false, duplicate: false, clientActionId, error };
  }
  return { recorded: true, duplicate: false, clientActionId };
}

module.exports = {
  findDriverClientAction,
  readClientActionId,
  recordDriverClientAction,
};
