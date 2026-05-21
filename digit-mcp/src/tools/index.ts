import type { ToolRegistry } from './registry.js';
import { registerDiscoverTools } from './discover-tools.js';
import { registerMdmsTenantTools } from './mdms-tenant.js';
import { registerValidatorTools } from './validators.js';
import { registerLocalizationTools } from './localization.js';
import { registerPgrWorkflowTools } from './pgr-workflow.js';
import { registerFilestoreAclTools } from './filestore-acl.js';
import { registerIdgenLocationTools } from './idgen-location.js';
import { registerEncryptionTools } from './encryption.js';
import { registerHealthCheckTools } from './health-check.js';
import { registerHrmsTools } from './hrms.js';
import { registerUserTools } from './user.js';
import { registerDocsTools } from './docs.js';
import { registerMonitoringTools } from './monitoring.js';
import { registerTracingTools } from './tracing.js';
import { registerApiCatalogTools } from './api-catalog.js';
import { registerSessionTools } from './sessions.js';

export function registerAllTools(registry: ToolRegistry): void {
  registerDiscoverTools(registry);
  registerMdmsTenantTools(registry);
  registerValidatorTools(registry);
  registerLocalizationTools(registry);
  registerPgrWorkflowTools(registry);
  registerFilestoreAclTools(registry);
  registerIdgenLocationTools(registry);
  registerEncryptionTools(registry);
  registerHealthCheckTools(registry);
  registerHrmsTools(registry);
  registerUserTools(registry);
  registerDocsTools(registry);
  registerMonitoringTools(registry);
  registerTracingTools(registry);
  registerApiCatalogTools(registry);
  registerSessionTools(registry);
}
