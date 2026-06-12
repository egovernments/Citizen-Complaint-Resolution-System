import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class AppController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  searchCities(@Query('q') q: string, @Query('fuzzy') fuzzy: string) {
    if (!q) {
      return { results: [] };
    }
    const useFuzzy = fuzzy !== 'false' && fuzzy !== '0';
    
    const startTime = Date.now();
    const results = this.searchService.search(q, useFuzzy);
    const endTime = Date.now();
    
    return {
      query: q,
      fuzzy: useFuzzy,
      timeMs: endTime - startTime,
      count: results.length,
      results
    };
  }
}
