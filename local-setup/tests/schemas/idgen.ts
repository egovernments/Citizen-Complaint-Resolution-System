import { z } from 'zod';

// ID Request
export const IdRequestSchema = z.object({
  idName: z.string(),
  tenantId: z.string(),
  format: z.string(),
});

// Generate ID request
export const GenerateIdRequestSchema = z.object({
  RequestInfo: z.object({
    apiId: z.string(),
    ver: z.string().optional(),
    action: z.string().optional(),
    msgId: z.string().optional(),
  }),
  idRequests: z.array(IdRequestSchema).min(1),
});

// ID Response
export const IdResponseSchema = z.object({
  id: z.string(),
});

// Generate ID response
export const GenerateIdResponseSchema = z.object({
  responseInfo: z.object({
    apiId: z.string().nullable().optional(),
    ver: z.string().nullable().optional(),
    ts: z.number().nullable().optional(),
    resMsgId: z.string().nullable().optional(),
    msgId: z.string().nullable().optional(),
    status: z.string(),
  }),
  idResponses: z.array(IdResponseSchema).min(1),
});

// Validate ID format pattern
export function validateIdFormat(id: string, expectedPrefix: string): boolean {
  return id.startsWith(expectedPrefix);
}

// Extract sequence number from generated ID
export function extractSequenceFromId(id: string): number | null {
  const match = id.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export type IdRequest = z.infer<typeof IdRequestSchema>;
export type GenerateIdRequest = z.infer<typeof GenerateIdRequestSchema>;
export type GenerateIdResponse = z.infer<typeof GenerateIdResponseSchema>;
