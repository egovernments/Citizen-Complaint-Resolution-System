import { z } from 'zod';

// Localization message
export const MessageSchema = z.object({
  code: z.string(),
  message: z.string(),
  module: z.string(),
  locale: z.string(),
});

// Search messages request
export const SearchMessagesRequestSchema = z.object({
  RequestInfo: z.object({
    apiId: z.string(),
    ver: z.string().optional(),
    action: z.string().optional(),
    msgId: z.string().optional(),
  }),
});

// Search messages response
export const SearchMessagesResponseSchema = z.object({
  responseInfo: z.object({
    apiId: z.string().nullable().optional(),
    ver: z.string().nullable().optional(),
    ts: z.number().nullable().optional(),
    resMsgId: z.string().nullable().optional(),
    msgId: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
  }).nullable().optional(),
  messages: z.array(MessageSchema),
});

// Upsert messages request
export const UpsertMessagesRequestSchema = z.object({
  RequestInfo: z.object({
    apiId: z.string(),
    ver: z.string().optional(),
    action: z.string().optional(),
    msgId: z.string().optional(),
    authToken: z.string().optional(),
    userInfo: z.object({
      id: z.number().optional(),
      userName: z.string().optional(),
      tenantId: z.string(),
      type: z.string(),
    }).optional(),
  }),
  tenantId: z.string(),
  messages: z.array(z.object({
    code: z.string(),
    message: z.string(),
    module: z.string(),
    locale: z.string(),
  })),
});

export type Message = z.infer<typeof MessageSchema>;
export type SearchMessagesRequest = z.infer<typeof SearchMessagesRequestSchema>;
export type SearchMessagesResponse = z.infer<typeof SearchMessagesResponseSchema>;
export type UpsertMessagesRequest = z.infer<typeof UpsertMessagesRequestSchema>;
