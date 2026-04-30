'use strict';

/**
 * Express middleware factory for Zod request-body validation.
 * Returns 400 with the first human-readable error if validation fails.
 * Does NOT replace req.body — existing route field extraction is preserved.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue.path.length ? issue.path.join('.') : 'body';
      return res.status(400).json({ error: `${field}: ${issue.message}` });
    }
    next();
  };
}

module.exports = { validate };
