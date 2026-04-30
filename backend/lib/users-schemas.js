const { z } = require('zod');

const USER_ROLES = ['admin', 'manager', 'driver'];

const nullableField = z.preprocess(
  (v) => { if (v === undefined) return undefined; return (v && String(v).trim()) || null; },
  z.string().min(1).nullable().optional()
);

const userCreateBodySchema = z.object({
  name:     z.string().trim().min(1, 'Name is required'),
  email:    z.string().trim().email('Valid email required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role:     z.enum(USER_ROLES, { errorMap: () => ({ message: 'Invalid role' }) }).default('driver'),
}).strict();

const userInviteBodySchema = z.object({
  name:         z.string().trim().min(1, 'Name is required'),
  email:        z.string().trim().email('Valid email required'),
  role:         z.enum(USER_ROLES, { errorMap: () => ({ message: 'Invalid role' }) }).default('driver'),
  companyId:    z.string().trim().optional(),
  companyName:  z.string().trim().optional(),
  locationId:   z.string().trim().optional(),
  locationName: z.string().trim().optional(),
}).strict();

const userPatchBodySchema = z.object({
  name:       z.string().trim().min(1, 'Name required'),
  phone:      nullableField,
  vehicle_id: nullableField,
}).strict();

const userRolePatchBodySchema = z.object({
  role: z.enum(USER_ROLES, { errorMap: () => ({ message: 'Invalid role' }) }),
}).strict();

module.exports = { userCreateBodySchema, userInviteBodySchema, userPatchBodySchema, userRolePatchBodySchema };
