import { Controller, Get, Query } from '@nestjs/common';
import { BoundaryService } from './boundary.service';

@Controller('boundary')
export class BoundaryController {
  constructor(private readonly boundaryService: BoundaryService) {}

  @Get('search')
  async search(
    @Query('q') query: string,
    @Query('source') source = 'geoapify',
  ) {
    if (!query) {
      return { features: [] };
    }
    return this.boundaryService.search(query, source);
  }

  @Get('fetch')
  async fetch(
    @Query('id') id: string,
    @Query('source') source = 'geoapify',
  ) {
    if (!id) {
      return { type: 'FeatureCollection', features: [] };
    }
    return this.boundaryService.fetchBoundaries(id, source);
  }
}
