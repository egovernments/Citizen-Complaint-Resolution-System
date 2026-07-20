import type { ApiError, ErrorCategory } from './types.js';

function deriveErrorCategory(statusCode: number): ErrorCategory {
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode >= 400 && statusCode < 500) return 'validation';
  return 'api';
}

export class ApiClientError extends Error {
  public errors: ApiError[];
  public statusCode: number;
  public category: ErrorCategory;

  constructor(errors: ApiError[], statusCode: number) {
    super(errors.map((e) => e.message || e.code || 'Unknown error').join(', '));
    this.name = 'ApiClientError';
    this.errors = errors;
    this.statusCode = statusCode;
    this.category = deriveErrorCategory(statusCode);
  }

  /** First error message for display */
  get firstError(): string {
    return this.errors[0]?.message || this.message;
  }
}
