/**
 * Screener HTTP surface (spec 03; ticket 02).
 *
 *   GET /screener?board&sector&shariah&priceMin…&sort&dir&offset&limit=
 *
 * Deliberately carries NO `@RequiresJob`: anonymous free-tier browsing
 * (ADR-0005) — the global TierGuard passes any route without it, same as
 * the spec-02/04 read surfaces.
 *
 * The 29 filter/sort/page params ride ONE whole-`@Query()` object — 29
 * individual `@Query('…')` decorators would be unmaintainable — narrowed by
 * the pure `rawScreenerParams` picker (the single home of the HTTP
 * param-name mapping, unit-pinned). The controller only picks and
 * delegates; resolution (clamp/drop, never a 400), the class-2 cache and
 * the resolved-value echo live in `ScreenerService`.
 */

import { Controller, Get, Query } from '@nestjs/common';
import { rawScreenerParams } from './params';
import { ScreenerService, type ScreenerResponse } from './screener.service';

@Controller('screener')
export class ScreenerController {
  constructor(private readonly screener: ScreenerService) {}

  /** `GET /screener` — one filtered page of the analysed universe. */
  @Get()
  async screen(@Query() query: unknown): Promise<ScreenerResponse> {
    return this.screener.screen(rawScreenerParams(query));
  }
}
