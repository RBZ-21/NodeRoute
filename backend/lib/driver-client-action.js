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
  return { duplicate: false, clientActionId, userId: req.user.id };
}

async function forgetDriverClientAction(action) {
  if (!action?.clientActionId || !action?.userId || action.duplicate) return;
  const { error } = await supabase
    .from('driver_client_actions')
    .delete()
    .eq('user_id', action.userId)
    .eq('client_action_id', action.clientActionId);
  if (error) {
    console.error('[driver-client-action] failed to release action marker:', error.message || error);
  }
}

async function respondWithClientActionFailure(res, action, status, body) {
  await forgetDriverClientAction(action);
  return res.status(status).json(body);
}

module.exports = {
  forgetDriverClientAction,
  readClientActionId,
  recordDriverClientAction,
  respondWithClientActionFailure,
};
