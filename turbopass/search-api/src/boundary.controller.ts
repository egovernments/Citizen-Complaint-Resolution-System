import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { BoundaryService } from './boundary.service';
import { MATCH_MODES, isMatchMode } from './boundary-matcher';

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;

/** min_descendants: blank → 0; otherwise a non-negative integer. */
export function parseMinDescendants(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(
      `min_descendants must be a non-negative integer, got '${raw}'`,
    );
  }
  return Number(raw);
}

export function parseSearchLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_SEARCH_LIMIT;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new BadRequestException(
      `limit must be a positive integer, got '${raw}'`,
    );
  }
  return Math.min(Number(raw), MAX_SEARCH_LIMIT);
}

@Controller('boundary')
export class BoundaryController {
  constructor(private readonly boundaryService: BoundaryService) {}

  // GET /boundary/search?q=&source=&match=&limit=&min_descendants=
  //   match: exact | prefix | substring (default) | fuzzy — how the name matches.
  //          Results are always ranked exact → prefix → substring → fuzzy, then
  //          broadest admin level first. Unknown values → 400.
  //   limit: 1..50, default 10.
  //   min_descendants: only places with at least this many areas under them
  //          (default 0). The configurator sends 1 — a place with nothing under
  //          it can't form a hierarchy.
  // All three apply to source=overture; the geoapify passthrough ignores them.
  // source defaults to overture, the offline source that needs no API key.
  @Get('search')
  async search(
    @Query('q') query: string,
    @Query('source') source = 'overture',
    @Query('match') match = 'substring',
    @Query('limit') limit?: string,
    @Query('min_descendants') minDescendants?: string,
  ) {
    if (!isMatchMode(match)) {
      throw new BadRequestException(
        `Unsupported match '${match}'; expected one of: ${MATCH_MODES.join(', ')}`,
      );
    }
    const n = parseSearchLimit(limit);
    const minDesc = parseMinDescendants(minDescendants);
    if (!query) {
      return { features: [] };
    }
    return this.boundaryService.search(query, source, match, n, minDesc);
  }

  @Get('fetch')
  async fetch(@Query('id') id: string, @Query('source') source = 'overture') {
    if (!id) {
      return { type: 'FeatureCollection', features: [] };
    }
    return this.boundaryService.fetchBoundaries(id, source);
  }
}
