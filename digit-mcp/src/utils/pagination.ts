// Auto-pagination helper for search tools.
// Fetches all pages and combines results into a single array.

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_ITEMS = 500;
const MAX_ITEMS_CAP = 2000;
const DEFAULT_DELAY_MS = 100;

export interface PaginationOptions {
  /** Enable auto-pagination to fetch all pages */
  page_all?: boolean;
  /** Maximum total items to fetch (default: 500, cap: 2000) */
  page_limit?: number;
  /** Delay between page fetches in ms (default: 100) */
  page_delay_ms?: number;
}

export interface PaginationResult<T> {
  items: T[];
  totalFetched: number;
  pages: number;
  truncated: boolean;
}

/**
 * Auto-paginate a search function that accepts limit/offset and returns an array.
 * Fetches pages sequentially until all results are retrieved or page_limit is reached.
 */
export async function autoPaginate<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[]>,
  options: PaginationOptions,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PaginationResult<T>> {
  const maxItems = Math.min(options.page_limit ?? DEFAULT_MAX_ITEMS, MAX_ITEMS_CAP);
  const delayMs = options.page_delay_ms ?? DEFAULT_DELAY_MS;

  const allItems: T[] = [];
  let offset = 0;
  let pages = 0;
  let truncated = false;

  while (allItems.length < maxItems) {
    const remaining = maxItems - allItems.length;
    const limit = Math.min(pageSize, remaining);

    const page = await fetchPage(limit, offset);
    pages++;
    allItems.push(...page);

    // If we got fewer items than requested, we've reached the end
    if (page.length < limit) break;

    // If we've hit the max, mark as truncated
    if (allItems.length >= maxItems) {
      truncated = true;
      break;
    }

    offset += page.length;

    // Delay between pages to avoid rate limiting
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    items: allItems.slice(0, maxItems),
    totalFetched: allItems.length,
    pages,
    truncated,
  };
}

/** JSON Schema properties for pagination parameters — add to any search tool's inputSchema */
export const PAGINATION_SCHEMA_PROPERTIES = {
  page_all: {
    type: 'boolean',
    description: 'Fetch all pages automatically and combine into a single response. Default: false.',
  },
  page_limit: {
    type: 'number',
    description: 'Maximum total items when using page_all (default: 500, cap: 2000).',
  },
  page_delay_ms: {
    type: 'number',
    description: 'Delay in ms between page fetches when using page_all (default: 100).',
  },
};
