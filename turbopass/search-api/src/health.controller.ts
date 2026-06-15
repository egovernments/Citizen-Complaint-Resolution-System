import { Controller, Get } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('health')
export class HealthController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  health() {
    return {
      status: 'ok',
      locationsLoaded: this.searchService.getLocationsLoaded(),
    };
  }
}
