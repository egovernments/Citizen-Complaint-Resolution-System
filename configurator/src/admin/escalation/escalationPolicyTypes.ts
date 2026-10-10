import type { EscalationConfigData, EscalationLevelOverride } from '@/api/types';

export interface CatalogueItem {
  code: string;
  name: string;
  department: string;
  departments?: string[];
  slaHours: number;
  path: string;
  parentCode?: string;
  levelCode?: string;
  override?: EscalationLevelOverride;
  isOrphaned?: boolean;
}

export type StatusFilter = 'all' | 'override' | 'default' | 'disabled' | 'orphaned';

export interface FilterState {
  search: string;
  status: StatusFilter;
  department: string;
}

export interface ValidationErrors {
  maxDepth?: string;
  percentages?: string[];
  fallbacks?: string[];
  eligibleStatuses?: string;
  general?: string;
}

export type { EscalationConfigData, EscalationLevelOverride };
