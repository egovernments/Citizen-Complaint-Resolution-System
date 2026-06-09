import { useState, useCallback } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface MutationErrorInfo {
  message: string;
  code?: string;
  statusCode?: number;
  hint?: string;
}

/** Map of DIGIT server error codes to actionable user-facing hints.
 *  Outer codes (like ERR_HRMS_USER_CREATION_FAILED) wrap inner reasons the
 *  service doesn't expose — the hints point operators at the most common
 *  culprit so they don't need to open container logs to self-serve. */
const CODE_HINTS: Record<string, string> = {
  ERR_HRMS_USER_CREATION_FAILED:
    'Most likely the mobile number does not match the tenant’s configured format, or the username / mobile is already in use on the user service. Check the Mobile Number field hint.',
  ERR_HRMS_USER_EXIST_MOB:
    'This mobile number is already registered. Use a different one.',
  ERR_HRMS_USER_EXIST_USERNAME:
    'This username is already taken. Change the Name (username auto-derives) or type a unique username.',
  ERR_HRMS_EMPLOYEE_EXIST:
    'An employee with this code already exists on the tenant.',
  INVALID_MOBILE_FORMAT:
    'Mobile does not match the tenant’s configured format.',
  INVALID_USER_NAME:
    'Username must be lowercase letters / digits / dots only.',
  'CORE_COMMON_MOBILE_ERROR':
    'Mobile does not match the tenant’s configured format.',
};

function codeHint(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (CODE_HINTS[code]) return CODE_HINTS[code];
  // NotNull.foo.bar.baz -> "Required field missing: foo.bar.baz"
  if (code.startsWith('NotNull.') || code.startsWith('NotEmpty.')) {
    const path = code.split('.').slice(1).join('.');
    return `Required field missing or empty: ${path}`;
  }
  return undefined;
}

export function extractMutationError(err: unknown): MutationErrorInfo {
  if (!err) return { message: 'Unknown error' };
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const errorsArr = Array.isArray(e.errors) ? (e.errors as Array<Record<string, unknown>>) : null;
    if (errorsArr && errorsArr[0]) {
      const message =
        (typeof errorsArr[0].message === 'string' && errorsArr[0].message) ||
        (typeof errorsArr[0].code === 'string' && errorsArr[0].code) ||
        'Unknown error';
      const code = typeof errorsArr[0].code === 'string' ? errorsArr[0].code : undefined;
      const statusCode = typeof e.statusCode === 'number' ? e.statusCode : undefined;
      return { message, code, statusCode, hint: codeHint(code) };
    }
    if (typeof e.message === 'string') {
      const statusCode = typeof e.statusCode === 'number' ? e.statusCode : undefined;
      return { message: e.message, statusCode };
    }
  }
  return { message: String(err) };
}

export function useMutationError() {
  const [info, setInfo] = useState<MutationErrorInfo | null>(null);
  const capture = useCallback((err: unknown) => setInfo(extractMutationError(err)), []);
  const clear = useCallback(() => setInfo(null), []);
  return { info, capture, clear };
}

interface BannerProps {
  info: MutationErrorInfo | null;
  onDismiss: () => void;
}

export function MutationErrorBanner({ info, onDismiss }: BannerProps) {
  if (!info) return null;
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Save failed</p>
            <p className="text-sm mt-0.5 break-words">{info.message}</p>
            {info.hint && (
              <p className="text-sm mt-1 opacity-90">{info.hint}</p>
            )}
            {(info.code || info.statusCode) && (
              <p className="text-xs opacity-70 mt-1 font-mono">
                {info.statusCode ? `${info.statusCode} · ` : ''}
                {info.code ?? ''}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="shrink-0 hover:opacity-70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
