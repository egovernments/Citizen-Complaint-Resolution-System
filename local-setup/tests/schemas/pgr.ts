import { z } from 'zod';

// Address schema - all fields can be null from API
export const AddressSchema = z.object({
  city: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  locality: z.object({
    code: z.string(),
    name: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    children: z.any().nullable().optional(),
    materializedPath: z.string().nullable().optional(),
  }).nullable().optional(),
  pincode: z.string().nullable().optional(),
  landmark: z.string().nullable().optional(),
  doorNo: z.string().nullable().optional(),
  plotNo: z.string().nullable().optional(),
  buildingName: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  tenantId: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
  additionDetails: z.any().nullable().optional(),
  geoLocation: z.object({
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    additionalDetails: z.any().nullable().optional(),
  }).nullable().optional(),
}).passthrough();

// PGR Service (complaint) - passthrough allows additional API fields
export const ServiceSchema = z.object({
  tenantId: z.string(),
  serviceCode: z.string(),
  serviceRequestId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  applicationStatus: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  address: AddressSchema.nullable().optional(),
  auditDetails: z.object({
    createdBy: z.string().nullable().optional(),
    lastModifiedBy: z.string().nullable().optional(),
    createdTime: z.number().nullable().optional(),
    lastModifiedTime: z.number().nullable().optional(),
  }).nullable().optional(),
}).passthrough();

// Service Wrapper (includes workflow)
export const ServiceWrapperSchema = z.object({
  service: ServiceSchema,
  workflow: z.object({
    action: z.string().nullable().optional(),
    assignes: z.array(z.string()).nullable().optional(),
    comments: z.string().nullable().optional(),
    verificationDocuments: z.any().nullable().optional(),
  }).nullable().optional(),
});

// Search request
export const SearchServiceRequestSchema = z.object({
  RequestInfo: z.object({
    apiId: z.string(),
    ver: z.string().optional(),
    action: z.string().optional(),
    msgId: z.string().optional(),
    authToken: z.string().optional(),
    userInfo: z.object({
      uuid: z.string(),
      type: z.string(),
      tenantId: z.string(),
    }).optional(),
  }),
});

// Response info schema - handles both ResponseInfo and responseInfo
const ResponseInfoSchema = z.object({
  apiId: z.string().nullable().optional(),
  ver: z.string().nullable().optional(),
  ts: z.number().nullable().optional(),
  resMsgId: z.string().nullable().optional(),
  msgId: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).nullable().optional();

// Search response - accepts both ResponseInfo (uppercase) and responseInfo (lowercase)
export const SearchServiceResponseSchema = z.object({
  ResponseInfo: ResponseInfoSchema,
  responseInfo: ResponseInfoSchema,
  ServiceWrappers: z.array(ServiceWrapperSchema),
}).partial({ ResponseInfo: true, responseInfo: true });

// Create request
export const CreateServiceRequestSchema = z.object({
  RequestInfo: z.object({
    apiId: z.string(),
    ver: z.string().optional(),
    action: z.string().optional(),
    msgId: z.string().optional(),
    authToken: z.string().optional(),
    userInfo: z.object({
      uuid: z.string(),
      type: z.string(),
      tenantId: z.string(),
    }),
  }),
  service: z.object({
    tenantId: z.string(),
    serviceCode: z.string(),
    description: z.string().optional(),
    source: z.string().optional(),
    address: AddressSchema.optional(),
  }),
});

export type Address = z.infer<typeof AddressSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceWrapper = z.infer<typeof ServiceWrapperSchema>;
export type SearchServiceResponse = z.infer<typeof SearchServiceResponseSchema>;
