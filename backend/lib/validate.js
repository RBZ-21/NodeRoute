'use strict';

// Simple schema validators for request bodies.
// Each returns null on pass, or an error string on fail.
// compose() runs all checks and returns the first failure, or null.

function required(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return `${name} is required`;
  }
  return null;
}

function maxLen(value, name, max) {
  if (value !== undefined && value !== null && String(value).length > max) {
    return `${name} must be at most ${max} characters`;
  }
  return null;
}

function isArray(value, name) {
  if (!Array.isArray(value)) return `${name} must be an array`;
  return null;
}

function maxItems(value, name, max) {
  if (Array.isArray(value) && value.length > max) {
    return `${name} may contain at most ${max} items`;
  }
  return null;
}

// Returns the first non-null result, or null if all pass.
function compose(...checks) {
  for (const result of checks) {
    if (result !== null && result !== undefined) return result;
  }
  return null;
}

module.exports = { required, maxLen, isArray, maxItems, compose };
