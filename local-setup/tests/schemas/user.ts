import { z } from 'zod';

// Role schema
export const RoleSchema = z.object({
  code: z.string(),
  name: z.string(),
  tenantId: z.string(),
});

// User schema (response)
export const UserSchema = z.object({
  id: z.number(),
  uuid: z.string().uuid(),
  userName: z.string(),
  name: z.string(),
  mobileNumber: z.string().nullable().optional(),
  emailId: z.string().nullable().optional(),
  tenantId: z.string(),
  type: z.enum(['CITIZEN', 'EMPLOYEE', 'SYSTEM']),
  active: z.boolean(),
  roles: z.array(RoleSchema),
  createdDate: z.string().optional(), // "05-02-2026 05:28:01" format
  lastModifiedDate: z.string().optional(),
  gender: z.string().nullable().optional(),
  // Additional nullable fields
  salutation: z.string().nullable().optional(),
  alternatemobilenumber: z.string().nullable().optional(),
  altContactNumber: z.string().nullable().optional(),
  pan: z.string().nullable().optional(),
  aadhaarNumber: z.string().nullable().optional(),
  permanentAddress: z.string().nullable().optional(),
  permanentCity: z.string().nullable().optional(),
  permanentPinCode: z.string().nullable().optional(),
  correspondenceAddress: z.string().nullable().optional(),
  correspondenceCity: z.string().nullable().optional(),
  correspondencePinCode: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  accountLocked: z.boolean().optional(),
  accountLockedDate: z.number().nullable().optional(),
  fatherOrHusbandName: z.string().nullable().optional(),
  relationship: z.string().nullable().optional(),
  signature: z.string().nullable().optional(),
  bloodGroup: z.string().nullable().optional(),
  photo: z.string().nullable().optional(),
  identificationMark: z.string().nullable().optional(),
  createdBy: z.number().nullable().optional(),
  lastModifiedBy: z.number().nullable().optional(),
  password: z.string().nullable().optional(),
  otpReference: z.string().nullable().optional(),
  dob: z.string().nullable().optional(),
  pwdExpiryDate: z.string().nullable().optional(),
});

// Create user request
export const CreateUserRequestSchema = z.object({
  RequestInfo: z.object({
    apiId: z.string(),
    ver: z.string(),
    action: z.string(),
    msgId: z.string(),
  }),
  User: z.object({
    userName: z.string().min(1),
    name: z.string().min(1),
    mobileNumber: z.string().optional(),
    gender: z.string().optional(),
    active: z.boolean(),
    type: z.enum(['CITIZEN', 'EMPLOYEE', 'SYSTEM']),
    tenantId: z.string(),
    password: z.string().min(6),
    roles: z.array(z.object({
      code: z.string(),
      name: z.string(),
      tenantId: z.string(),
    })),
  }),
});

// Create user response
export const CreateUserResponseSchema = z.object({
  responseInfo: z.object({
    apiId: z.string().nullable().optional(),
    ver: z.string().nullable().optional(),
    ts: z.number().nullable().optional(),
    resMsgId: z.string().nullable().optional(),
    msgId: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
  }).optional(),
  user: z.array(UserSchema).min(1),
});

// Login response
export const LoginResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
});

// Error response
export const ErrorResponseSchema = z.object({
  ResponseInfo: z.object({
    apiId: z.string().nullable().optional(),
    ver: z.string().nullable().optional(),
    ts: z.number().nullable().optional(),
    resMsgId: z.string().nullable().optional(),
    msgId: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
  }).optional().nullable(),
  Errors: z.array(z.object({
    code: z.string(),
    message: z.string(),
    description: z.string().nullable().optional(),
  })).optional(),
});

export type User = z.infer<typeof UserSchema>;
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
