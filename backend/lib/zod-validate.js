'use strict';

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

function validateQuery(schema, options) {
  return validatePart('query', schema, options);
}

function validateParams(schema, options) {
  return validatePart('params', schema, options);
}

module.exports = {
  validateBody,
  validateQuery,
  validateParams,
  firstIssueMessage,
};
