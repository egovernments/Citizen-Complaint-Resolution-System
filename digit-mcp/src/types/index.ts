// Re-export shared types from @digit-mcp/data-provider
export { MDMS_SCHEMAS } from '@digit-mcp/data-provider/client';
export type { ErrorCategory, RequestInfo, UserInfo, Role, MdmsRecord, ApiError, Environment } from '@digit-mcp/data-provider/client';

// MCP-specific types

// Tool groups for progressive disclosure
export type ToolGroup = 'core' | 'mdms' | 'boundary' | 'masters' | 'employees' | 'localization' | 'pgr' | 'admin' | 'idgen' | 'location' | 'encryption' | 'docs' | 'monitoring' | 'tracing' | 'snapshot';

export const ALL_GROUPS: ToolGroup[] = ['core', 'mdms', 'boundary', 'masters', 'employees', 'localization', 'pgr', 'admin', 'idgen', 'location', 'encryption', 'docs', 'monitoring', 'tracing', 'snapshot'];

// Tool metadata stored in the registry
/**
 * Minimum authorization a caller needs to invoke a tool.
 *
 * Authentication alone is not enough: DIGIT lets citizens self-register (PGR
 * auto-provisions them), so "holds a valid token" is a low bar. This is the
 * citizen/employee/admin boundary applied on top of identity.
 *
 * - `public`    — no role requirement. Only for tools that expose neither DIGIT
 *                 data nor infrastructure detail (docs, discovery, health).
 * - `employee`  — caller must not be a citizen-only account. The DEFAULT when a
 *                 tool omits `access`, so a newly added tool is never public by
 *                 accident.
 * - `admin`     — caller must hold one of MCP_ADMIN_ROLES. For destructive or
 *                 PII-revealing tools.
 */
export type ToolAccess = 'public' | 'employee' | 'admin';

export interface ToolMetadata {
  name: string;
  group: ToolGroup;
  category: 'discovery' | 'environment' | 'mdms' | 'validation' | 'localization' | 'pgr' | 'workflow' | 'filestore' | 'access-control' | 'idgen' | 'location' | 'encryption' | 'boundary-mgmt' | 'hrms' | 'user' | 'docs' | 'monitoring' | 'tracing' | 'sessions' | 'snapshot';
  risk: 'read' | 'write';
  /** Minimum caller authorization. Omitted => 'employee' (see ToolAccess). */
  access?: ToolAccess;
  /**
   * Set when a tool's OUTPUT is sensitive (decrypted PII, credentials). The
   * session store records a placeholder instead of the usual result prefix,
   * so plaintext never lands in the events table or the JSONL log.
   */
  sensitiveOutput?: boolean;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  summary: string;
}

export interface ValidationError {
  field: string;
  value?: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  value?: string;
  message: string;
}
