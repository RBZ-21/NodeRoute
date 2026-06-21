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

/**
 * Record a driver client action id for idempotent replay.
 * Returns { duplicate: true } when this user already processed the action.
 */
async function recordDriverClientAction(req, { actionType, resourceId = null }) {
  const clientActionId = readClientActionId(req);
  if (!clientActionId || !req.user?.id) return { duplicate: false, clientActionId: null };

  const { error } = await supabase.from('driver_client_actions').insert({
    user_id: req.user.id,
    client_action_id: clientActionId,
    action_type: actionType,
    resource_id: resourceId ? String(resourceId) : null,
  });

  if (error?.code === '23505') {
    return { duplicate: true, clientActionId };
  }
  if (error) {
    const err = new Error('Failed to record client action');
    err.cause = error;
    throw err;
  }
  return { duplicate: false, clientActionId };
}

module.exports = {
  readClientActionId,
  recordDriverClientAction,
};
