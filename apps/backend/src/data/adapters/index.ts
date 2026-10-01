/**
 * Source-adapter seam (spec 01 "Source-adapter seam"; ticket 02) — barrel export.
 *
 * Consumers import the interfaces + DI tokens from here and inject a token; the
 * concrete demo adapter is bound in {@link AdaptersModule} and swaps for a licensed
 * production adapter with no consumer change.
 */
export * from './dto';
export * from './adapter.interfaces';
export * from './announcement-labels';
export * from './demo-adapters';
export * from './adapters.module';
