# 11 — Resolve local market cold-start and mixed-data readiness

Status: ready-for-human
Type: task
Blocked by: none

## Evidence

The 2026-10-15 [readiness audit](../readiness.md) found 5 stored synthetic indices
with 750 points each, but trading-hours `/market/indices` and `/market/sectors`
return empty arrays. `MarketService.loadLiveIndices` requires an outside-hours
cached identity catalogue; `eodIngested` invalidates that cache. No supported
startup warm-up occurs during market hours.

Movers use 5-stock synthetic replay prices during trading hours even alongside
real KLCI stock series (MAYBANK 3.843584 replay versus 10.040000 real stored close).
Ticks expire after 15 minutes without replay. Synthetic index history ends
2025-12-31 while real stock history reaches 2026-10-15. This is not one coherent
current market dataset, although provenance labels distinguish it.

## Required decision/work

Choose an honest supported local showcase policy (for example, explicitly sourced
stored-data fallback rather than a misleading live claim). Make index identities
discoverable on cold startup and keep missing ticks panel-local. Preserve actual
history dates and synthetic analogue names. Do not spoof the clock, insert cache
fixtures, write synthetic bars over real stock data or relabel synthetic as real.

This touches existing cache-class/market-hours decisions: agree the approach in
plan mode before implementation rather than silently redesigning in the audit.

## Acceptance / verification

- Cold local API during trading hours can discover the stored headline by kind
  and its history, with explicit source/freshness semantics.
- Movers/stock price provenance differences are either eliminated through a
  supported data path or made explicitly distinct and operator-approved.
- Tests cover cold identity cache, missing/expired ticks and preserved provenance;
  re-audit actual API reads during market hours.
