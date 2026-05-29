'use strict';

const { z } = require('zod');

function firstIssueMessage(error, fallback) {
  if (Array.isArray(error?.issues) && error.issues[0]?.message) {
    return error.issues[0].message;
  }
  return fallback;
}

function validatePart(part, schema, options = {}) {
  const fallbackMessage = options.fallbackMessage || 'Invalid request payload';

  return async function zodValidationMiddleware(req, res, next) {
    const result = await schema.safeParseAsync(req[part]);
    if (!result.success) {
      return res.status(400).json({ error: firstIssueMessage(result.error, fallbackMessage) });
    }

    req.validated = req.validated || {};
    req.validated[part] = result.data;
    return next();
  };
}

function validateBody(schema, options) {
  return validatePart('body', schema, options);
}

function validate(schema, options) {
  return validateBody(schema, options);
}

function validateQuery(schema, options) {
  return validatePart('query', schema, options);
}

function validateParams(schema, options) {
  return validatePart('params', schema, options);
}

const jsonMutationBodySchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

function validateJsonMutationBody() {
  return function jsonMutationBodyMiddleware(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (!req.is('application/json')) return next();

    const body = req.body === undefined ? {} : req.body;
    const result = jsonMutationBodySchema.safeParse(body);
    if (!result.success) {
      return res.status(400).json({ error: firstIssueMessage(result.error, 'JSON request body must be an object or array') });
    }

    req.body = result.data;
    return next();
  };
}

module.exports = {
  validate,
  validateBody,
  validateQuery,
  validateParams,
  validateJsonMutationBody,
  firstIssueMessage,
};
