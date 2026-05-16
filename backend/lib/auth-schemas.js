'use strict';

const { z } = require('zod');

const nonEmptyTrimmedString = z.string().trim().min(1);
const nonEmptyString = z.string().min(1);
const minPasswordLength = 8;
const setupPasswordLengthMessage = 'Password must be at least 8 characters';
const changePasswordLengthMessage = 'New password must be at least 8 characters';

function parseLoginBody(body) {
  const result = z.object({
    email: nonEmptyTrimmedString,
    password: nonEmptyString,
  }).safeParse(body);

  if (!result.success) {
    return { success: false, error: 'Email and password required' };
  }

  return { success: true, data: result.data };
}

function parseSetupPasswordBody(body) {
  const baseResult = z.object({
    token: nonEmptyTrimmedString,
    password: nonEmptyString,
  }).safeParse(body);

  if (!baseResult.success) {
    return { success: false, error: 'Token and password required' };
  }

  const passwordResult = z.string().min(minPasswordLength).safeParse(baseResult.data.password);
  if (!passwordResult.success) {
    return { success: false, error: setupPasswordLengthMessage };
  }

  return {
    success: true,
    data: {
      token: baseResult.data.token,
      password: passwordResult.data,
    },
  };
}

function parseChangePasswordBody(body) {
  const baseResult = z.object({
    currentPassword: nonEmptyString,
    newPassword: nonEmptyString,
  }).safeParse(body);

  if (!baseResult.success) {
    return { success: false, error: 'Both passwords required' };
  }

  const passwordResult = z.string().min(minPasswordLength).safeParse(baseResult.data.newPassword);
  if (!passwordResult.success) {
    return { success: false, error: changePasswordLengthMessage };
  }

  return {
    success: true,
    data: {
      currentPassword: baseResult.data.currentPassword,
      newPassword: passwordResult.data,
    },
  };
}

module.exports = {
  minPasswordLength,
  setupPasswordLengthMessage,
  changePasswordLengthMessage,
  parseLoginBody,
  parseSetupPasswordBody,
  parseChangePasswordBody,
};
