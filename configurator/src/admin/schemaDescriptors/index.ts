import type { SchemaDescriptor } from './types';
import { mobileValidationDescriptor } from './mobile-validation';
import { formValidationsDescriptor } from './form-validations';
import { themeConfigDescriptor } from './theme-config';
import { tenantBoundaryDescriptor } from './tenant-boundary';
import { autoEscalationIgnoreDescriptor } from './auto-escalation-ignore';
import { workflowBsMasterDescriptor } from './workflow-bs-master';
import { pgrUiConstantsDescriptor } from './pgr-ui-constants';
import { stateInfoDescriptor } from './state-info';
import { notificationRoutingDescriptor } from './notification-routing';
import { notificationTemplateDescriptor } from './notification-template';
import { mapConfigDescriptor } from './map-config';
import { landingSectionDescriptor } from './landing-section';
import { landingPageConfigDescriptor } from './landing-page-config';
import { cityModuleDescriptor } from './city-module';
import { uiHomePageDescriptor } from './ui-homepage';
import { securityPolicyDescriptor } from './data-security';
import { encryptionPolicyDescriptor } from './encryption-policy';
import { analyticsProviderDescriptor } from './analytics-provider';

/** Map of schema code -> descriptor. Add new entries as we cover more schemas. */
const DESCRIPTORS: Record<string, SchemaDescriptor> = {
  [mobileValidationDescriptor.schema]: mobileValidationDescriptor,
  [formValidationsDescriptor.schema]: formValidationsDescriptor,
  [themeConfigDescriptor.schema]: themeConfigDescriptor,
  [tenantBoundaryDescriptor.schema]: tenantBoundaryDescriptor,
  [autoEscalationIgnoreDescriptor.schema]: autoEscalationIgnoreDescriptor,
  [workflowBsMasterDescriptor.schema]: workflowBsMasterDescriptor,
  [pgrUiConstantsDescriptor.schema]: pgrUiConstantsDescriptor,
  [stateInfoDescriptor.schema]: stateInfoDescriptor,
  [notificationRoutingDescriptor.schema]: notificationRoutingDescriptor,
  [notificationTemplateDescriptor.schema]: notificationTemplateDescriptor,
  [mapConfigDescriptor.schema]: mapConfigDescriptor,
  [landingSectionDescriptor.schema]: landingSectionDescriptor,
  [landingPageConfigDescriptor.schema]: landingPageConfigDescriptor,
  [cityModuleDescriptor.schema]: cityModuleDescriptor,
  [uiHomePageDescriptor.schema]: uiHomePageDescriptor,
  [securityPolicyDescriptor.schema]: securityPolicyDescriptor,
  [encryptionPolicyDescriptor.schema]: encryptionPolicyDescriptor,
  [analyticsProviderDescriptor.schema]: analyticsProviderDescriptor,
};

export function getDescriptor(schemaCode?: string): SchemaDescriptor | undefined {
  if (!schemaCode) return undefined;
  return DESCRIPTORS[schemaCode];
}

export function getFieldSpec(descriptor: SchemaDescriptor | undefined, path: string) {
  return descriptor?.fields.find((f) => f.path === path);
}

export type { SchemaDescriptor, FieldSpec, FieldGroup, WidgetKind } from './types';
