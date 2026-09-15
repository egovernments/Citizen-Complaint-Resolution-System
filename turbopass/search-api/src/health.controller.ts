import { Controller, Get } from '@nestjs/common';
import { SearchService } from './search.service';
import { BoundaryService } from './boundary.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly searchService: SearchService,
    private readonly boundaryService: BoundaryService,
  ) {}

  // `sources` lets a client (the configurator) see which boundary sources this
  // server can actually answer — "Geoapify isn't configured here" instead of a
  // 500 on the first search.
  @Get()
  health() {
    return {
      status: 'ok',
      locationsLoaded: this.searchService.getLocationsLoaded(),
      sources: this.boundaryService.sources(),
      overture: this.boundaryService.overtureInfo(),
    };
  }
}
