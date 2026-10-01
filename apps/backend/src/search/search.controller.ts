import { Controller, Get, Query } from '@nestjs/common';
import { SearchService, type SearchResponse } from './search.service';

/**
 * Anonymous instrument search endpoint (spec 02; ticket 02; ADR-0005).
 *
 * `GET /search?q=&limit=` — deliberately carries NO `@RequiresJob`:
 * anonymous browsing is a free-tier capability, so the global TierGuard
 * passes the route through. Returns identity rows only (no prices or
 * fundamentals — those live on the stock page, ticket 03).
 */
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** `GET /search?q=…&limit=…` — trigram-ranked identity rows (class-2 cached). */
  @Get()
  async search(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<SearchResponse> {
    return this.searchService.search(q, limit);
  }
}
