'use strict';

const { z } = require('zod');

const nonEmptyTrimmedString = z.string().trim().min(1);
const nonEmptyString = z.string().min(1);
const minPasswordLength = 12;
const setupPasswordLengthMessage = 'Password must be at least 12 characters';
const changePasswordLengthMessage = 'New password must be at least 12 characters';

function parseLoginBody(body) {
  const result = z.object({
    email: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(1024),
  }).safeParse(body);

  if (!result.success) {
    return { success: false, error: 'Email and password required' };
  }

  return { success: true, data: result.data };
}

function parseSignupBody(body) {
  const result = z.object({
    email: z.string().trim().email('Valid email required').max(254),
    password: z.string().min(minPasswordLength, setupPasswordLengthMessage).max(1024),
    confirmPassword: z.string().min(1).max(1024),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    businessName: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(30).optional().default(''),
    address: z.string().trim().max(300).optional().default(''),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(2).max(2),
    zip: z.string().trim().max(10).optional().default(''),
    distributorType: z.enum(['seafood', 'liquor', 'wine', 'beer', 'food']),
    inventoryChoice: z.enum(['template', 'import', 'blank']),
    selectedTemplate: z.string().trim().max(50).optional().default(''),
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
    token: z.string().trim().min(1).max(256),
    password: z.string().min(1).max(1024),
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
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(1).max(1024),
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
