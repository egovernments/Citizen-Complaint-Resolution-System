// Re-export shared types from @digit-mcp/data-provider
export { MDMS_SCHEMAS } from '@digit-mcp/data-provider/client';
export type { ErrorCategory, RequestInfo, UserInfo, Role, MdmsRecord, ApiError, Environment } from '@digit-mcp/data-provider/client';

// MCP-specific types

// Tool groups for progressive disclosure
export type ToolGroup = 'core' | 'mdms' | 'boundary' | 'masters' | 'employees' | 'localization' | 'pgr' | 'admin' | 'idgen' | 'location' | 'encryption' | 'docs' | 'monitoring' | 'tracing';

export const ALL_GROUPS: ToolGroup[] = ['core', 'mdms', 'boundary', 'masters', 'employees', 'localization', 'pgr', 'admin', 'idgen', 'location', 'encryption', 'docs', 'monitoring', 'tracing'];

// Tool metadata stored in the registry
export interface ToolMetadata {
  name: string;
  group: ToolGroup;
  category: 'discovery' | 'environment' | 'mdms' | 'validation' | 'localization' | 'pgr' | 'workflow' | 'filestore' | 'access-control' | 'idgen' | 'location' | 'encryption' | 'boundary-mgmt' | 'hrms' | 'user' | 'docs' | 'monitoring' | 'tracing' | 'sessions';
  risk: 'read' | 'write';
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
