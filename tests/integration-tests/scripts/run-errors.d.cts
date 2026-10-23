// Types for run-errors.cjs.
type RunReport = { errors?: { message?: string }[] };
export declare const CUT_SHORT: RegExp[];
export declare function runErrors(report: RunReport): string[];
export declare function cutShortOf(report: RunReport): string | null;
