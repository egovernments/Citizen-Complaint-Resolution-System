import type { RaRecord } from 'ra-core';

export type MutationMode = 'pessimistic' | 'optimistic' | 'undoable';

export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
  custom?: (value: string) => string | null;
}

export type EditableCellType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'reference';

export interface EditableColumnConfig {
  type?: EditableCellType;
  validation?: ValidationRule;
  reference?: string;
  displayField?: string;
  options?: { value: string; label: string }[];
  mutationMode?: MutationMode;
  transform?: (value: unknown) => unknown;
}

export interface DigitColumn<RecordType extends RaRecord = RaRecord> {
  source: string;
  label: string;
  sortable?: boolean;
  render?: (record: RecordType) => React.ReactNode;
  editable?: boolean | EditableColumnConfig;
}

export interface MutationOptions {
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
  transform?: (data: Record<string, unknown>) => Record<string, unknown>;
}

export interface DigitDatagridProps<RecordType extends RaRecord = RaRecord> {
  columns: DigitColumn<RecordType>[];
  rowClick?: 'show' | 'edit' | string;
  onRowClick?: (record: RecordType) => void;
  rowActions?: 'auto' | 'none' | ((record: RecordType) => React.ReactNode);
  actions?: (record: RecordType) => React.ReactNode;
  mutationMode?: MutationMode;
  mutationOptions?: MutationOptions;
  noDelete?: boolean;
  configurable?: boolean;
  preferenceKey?: string;
  disableAutofocus?: boolean;
}
