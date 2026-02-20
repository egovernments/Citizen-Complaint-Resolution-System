import { z } from 'zod';

// MDMS Search request
export const MdmsSearchRequestSchema = z.object({
  RequestInfo: z.object({
    apiId: z.string(),
    ver: z.string().optional(),
    ts: z.number().optional(),
  }),
  MdmsCriteria: z.object({
    tenantId: z.string(),
    schemaCode: z.string(),
  }),
});

// MDMS data item
export const MdmsDataSchema = z.object({
  id: z.string().optional(),
  tenantId: z.string(),
  schemaCode: z.string(),
  uniqueIdentifier: z.string().optional(),
  data: z.record(z.unknown()),
  isActive: z.boolean().optional(),
  auditDetails: z.object({
    createdBy: z.string().optional(),
    lastModifiedBy: z.string().optional(),
    createdTime: z.number().optional(),
    lastModifiedTime: z.number().optional(),
  }).optional(),
});

// MDMS Search response
export const MdmsSearchResponseSchema = z.object({
  ResponseInfo: z.object({
    apiId: z.string().nullable().optional(),
    ver: z.string().nullable().optional(),
    ts: z.number().nullable().optional(),
    resMsgId: z.string().nullable().optional(),
    msgId: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
  }).nullable().optional(),
  mdms: z.array(MdmsDataSchema),
});

// Tenant data (from MDMS)
export const TenantSchema = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().optional(),
  logoId: z.string().optional(),
  imageId: z.string().optional(),
  domainUrl: z.string().optional(),
  type: z.string().optional(),
  twitterUrl: z.string().optional(),
  facebookUrl: z.string().optional(),
  emailId: z.string().optional(),
  OfficeTimings: z.object({
    Mon: z.string().optional(),
    Tue: z.string().optional(),
    Wed: z.string().optional(),
    Thu: z.string().optional(),
    Fri: z.string().optional(),
    Sat: z.string().optional(),
    Sun: z.string().optional(),
  }).optional(),
  city: z.object({
    name: z.string(),
    localName: z.string().optional(),
    districtCode: z.string().optional(),
    districtName: z.string().optional(),
    regionName: z.string().optional(),
    ulbGrade: z.string().optional(),
    longitude: z.number().optional(),
    latitude: z.number().optional(),
    captcha: z.string().optional(),
    code: z.string(),
  }).optional(),
  address: z.string().optional(),
  contactNumber: z.string().optional(),
});

export type MdmsSearchRequest = z.infer<typeof MdmsSearchRequestSchema>;
export type MdmsSearchResponse = z.infer<typeof MdmsSearchResponseSchema>;
export type MdmsData = z.infer<typeof MdmsDataSchema>;
export type Tenant = z.infer<typeof TenantSchema>;
