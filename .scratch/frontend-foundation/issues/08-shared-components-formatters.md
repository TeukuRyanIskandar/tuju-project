# Shared components and formatters

Type: task
Status: done
Blocked by: 06

## Task

- Components: `Panel`, `ChangeChip` (always a sign and an arrow),
  `ProvenanceBadge` and `ProvenanceContainer` (synthetic, AI, demo-only), table
  styling, `Kbd`, `LoadingState`, `EmptyState`, `ErrorState`.
- Formatters: RM amounts, percentages, volume, compact numbers, dates, and
  `formatPe` (null for a loss-making company shows "N/A (loss-making)").

## Done when

Unit tests cover every formatter and both `ChangeChip` and `ProvenanceBadge`;
colour is never the only signal (text and arrow present).

## Comments
