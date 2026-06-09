import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';

export function registerEncryptionTools(registry: ToolRegistry): void {
  // ──────────────────────────────────────────
  // encryption group
  // ──────────────────────────────────────────

  registry.register({
    name: 'encrypt_data',
    group: 'encryption',
    category: 'encryption',
    risk: 'write',
    description:
      'Encrypt sensitive data using the DIGIT encryption service (egov-enc-service). Accepts plain text values and returns encrypted strings. Does not require user authentication — the encryption service handles its own key management.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID for encryption context',
        },
        values: {
          type: 'array',
          items: { type: 'string' },
          description: 'Plain text values to encrypt',
        },
      },
      required: ['tenant_id', 'values'],
    },
    handler: async (args) => {
      const tenantId = args.tenant_id as string;
      const values = args.values as string[];

      const encrypted = await digitApi.encryptData(tenantId, values);

      return JSON.stringify(
        {
          success: true,
          count: encrypted.length,
          encrypted,
          tenantId,
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'decrypt_data',
    group: 'encryption',
    category: 'encryption',
    risk: 'write',
    description:
      'Decrypt encrypted data using the DIGIT encryption service (egov-enc-service). Accepts encrypted strings and returns plain text values. May fail if the encryption key is not configured for the tenant.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID for decryption context',
        },
        encrypted_values: {
          type: 'array',
          items: { type: 'string' },
          description: 'Encrypted values to decrypt',
        },
      },
      required: ['tenant_id', 'encrypted_values'],
    },
    handler: async (args) => {
      const tenantId = args.tenant_id as string;
      const encryptedValues = args.encrypted_values as string[];

      const decrypted = await digitApi.decryptData(tenantId, encryptedValues);

      return JSON.stringify(
        {
          success: true,
          count: decrypted.length,
          decrypted,
          tenantId,
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);
}
