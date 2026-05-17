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

function parseSignupBody(body) {
  const result = z.object({
    email: z.string().trim().email('Valid email required'),
    password: z.string().min(minPasswordLength, setupPasswordLengthMessage),
    confirmPassword: nonEmptyString,
    firstName: nonEmptyTrimmedString,
    lastName: nonEmptyTrimmedString,
    businessName: nonEmptyTrimmedString,
    phone: z.string().trim().optional().default(''),
    address: z.string().trim().optional().default(''),
    city: nonEmptyTrimmedString,
    state: z.string().trim().min(2).max(2),
    zip: z.string().trim().max(10).optional().default(''),
    distributorType: z.enum(['seafood', 'liquor', 'wine', 'beer', 'food']),
    inventoryChoice: z.enum(['template', 'import', 'blank']),
    selectedTemplate: z.string().trim().optional().default(''),
  }).safeParse(body);

  if (!result.success) {
    return {
      success: false,
      error: result.error.issues.map((issue) => issue.message).join(', ') || 'Invalid signup data',
    };
  }

  if (result.data.password !== result.data.confirmPassword) {
    return { success: false, error: 'Passwords do not match' };
  }

  if (result.data.inventoryChoice === 'template' && !result.data.selectedTemplate) {
    return { success: false, error: 'Choose a template to continue' };
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
  parseSignupBody,
  parseSetupPasswordBody,
  parseChangePasswordBody,
};
