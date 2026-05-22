import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings with clsx semantics, then dedupe conflicts.
 * Standard shadcn helper. Always import from `@v2/lib/cn`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
