/**
 * Free-tier domain model (spec 01) — barrel export.
 *
 * The shared relational model every other free-tier spec (02–06) reads. Provenance
 * is tracked as {@link IngestionRun} lineage (every sourced row FKs `ingestionRunId`),
 * not a per-row column, so the licence-boundary purge is a targeted delete.
 */
export * from './enums';
export * from './ingestion-run.entity';
export * from './synthetic-run.entity';
export * from './sector.entity';
export * from './company.entity';
export * from './instrument.entity';
export * from './price-bar.entity';
export * from './quarterly-financials.entity';
export * from './fundamentals-snapshot.entity';
export * from './indicator-snapshot.entity';
export * from './corporate-action.entity';
export * from './shariah-status.entity';
export * from './announcement.entity';
export * from './news-article.entity';
export * from './news-article-tag.entity';
export * from './ipo-listing.entity';
export * from './market-index.entity';
export * from './index-level.entity';
export * from './watchlist.entity';
export * from './watchlist-item.entity';
export * from './market-brief.entity';
export * from './prospectus-analysis.entity';

// Scaffold entity (pre-existing) — re-exported for a single import surface.
export * from './analysis-result.entity';
