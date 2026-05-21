/**
 * Shared progress channel used by long-running tools (tenant_bootstrap,
 * city_setup, …) to emit phase events that the REST shim streams back
 * to the caller as Server-Sent Events / JSON-Lines.
 *
 * Single mutable emitter — safe because the REST shim already wraps
 * each request in a process-wide mutex around the digitApi singleton.
 * Tools that don't care just call emitProgress(); a no-op when no
 * emitter is registered.
 */

export interface ProgressEvent {
  /** Short machine-readable phase label, e.g. "schemas:start". */
  phase: string;
  /** Optional human-readable message for UI rendering. */
  message?: string;
  /** Free-form structured payload (counts, codes, errors, …). */
  data?: Record<string, unknown>;
  /** Optional 0–100 progress hint when the tool can estimate one. */
  pct?: number;
}

type EmitterFn = (event: ProgressEvent) => void;

let activeEmitter: EmitterFn | null = null;

export function setProgressEmitter(fn: EmitterFn | null): void {
  activeEmitter = fn;
}

export function emitProgress(event: ProgressEvent): void {
  try {
    activeEmitter?.(event);
  } catch {
    // never let progress emit failures break the underlying tool
  }
}
