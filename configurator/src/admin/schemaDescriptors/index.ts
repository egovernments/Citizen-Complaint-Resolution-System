import type { SchemaDescriptor } from './types';
import { mobileValidationDescriptor } from './mobile-validation';
import { themeConfigDescriptor } from './theme-config';
import { tenantBoundaryDescriptor } from './tenant-boundary';
import { autoEscalationIgnoreDescriptor } from './auto-escalation-ignore';
import { workflowBsMasterDescriptor } from './workflow-bs-master';
import { pgrUiConstantsDescriptor } from './pgr-ui-constants';
import { stateInfoDescriptor } from './state-info';
import { landingSectionDescriptor } from './landing-section';
import { landingPageConfigDescriptor } from './landing-page-config';

/** Map of schema code -> descriptor. Add new entries as we cover more schemas. */
const DESCRIPTORS: Record<string, SchemaDescriptor> = {
  [mobileValidationDescriptor.schema]: mobileValidationDescriptor,
  [themeConfigDescriptor.schema]: themeConfigDescriptor,
  [tenantBoundaryDescriptor.schema]: tenantBoundaryDescriptor,
  [autoEscalationIgnoreDescriptor.schema]: autoEscalationIgnoreDescriptor,
  [workflowBsMasterDescriptor.schema]: workflowBsMasterDescriptor,
  [pgrUiConstantsDescriptor.schema]: pgrUiConstantsDescriptor,
  [stateInfoDescriptor.schema]: stateInfoDescriptor,
  [landingSectionDescriptor.schema]: landingSectionDescriptor,
  [landingPageConfigDescriptor.schema]: landingPageConfigDescriptor,
};

export function getDescriptor(schemaCode?: string): SchemaDescriptor | undefined {
  if (!schemaCode) return undefined;
  return DESCRIPTORS[schemaCode];
}

export function getFieldSpec(descriptor: SchemaDescriptor | undefined, path: string) {
  return descriptor?.fields.find((f) => f.path === path);
}

export type { SchemaDescriptor, FieldSpec, FieldGroup, WidgetKind } from './types';
