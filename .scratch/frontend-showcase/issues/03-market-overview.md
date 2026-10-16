# 03 — Build the market overview data panels

Status: ready-for-human
Type: task
Blocked by: None (03 → 02 explicitly waived; approved revision 2)

Dependency waiver: Only 03 → 02 is waived. Market panels use existing market
queries/contracts independently of ticket 02's stock/IPO analysis additions.
This does not complete ticket 02 or change its status or any other dependency.
Discovery is layout reservation only; no ticket 07 implementation.

## Goal

Replace `/` placeholder with the functional market home in [the spec](../spec.md).

## Work

- Build headline snapshot, index-history chart, movers tabs and sector board using
  existing market queries. Select headline by kind and series by returned ID.
- Default history 1m (controls 1m/3m/1y); default movers gainers, limit 10.
- Provide chart date/value inspection and accessible table; share chart primitives
  with stock work where useful without coupling query lifecycles.
- Reserve prominent discovery-panel slots for ticket 07.
- Display source class and truthful time labels: history date/retrieval time are
  not current quote time. Never brand synthetic levels as official live Bursa.

## Acceptance criteria

- Changing history range or movers type requests the corresponding supported
  parameters; returned data populates the correct panel.
- Movers navigate to stock routes; null changes remain unavailable, volume is
  not displayed as a price-change chip.
- Empty/error states are independent across panels, including history failure
  while snapshot remains visible.
- Synthetic/real provenance and missing quote times are explicit.
- Chart controls/table are keyboard accessible and labels do not rely on colour.

## Verification

Component/query tests for selections, numeric strings, nulls, mixed provenance
and independent failures; typecheck/test. Live data is verified in tickets 01/09.

## Comments

### 2026-10-16 — Reconciliation: implementation record

The home route now mounts `MarketOverview`, which independently reads the market
snapshot, history, movers and sectors; selects the headline by returned kind;
supports the documented history and movers controls; links movers to stock
detail; and labels provenance and unavailable quote time. The component tests
cover those controls, independent failures and the accessible table fallback.

This reconciliation did not rerun tests. Earlier frontend verification is
recorded in the tracker rather than re-claimed here. Discovery remains a reserved
layout area for ticket 07, and blocker-fix 13 explicitly deferred shared chart
primitives. Live market-data readiness and human review remain outside this
ticket, so its status is `ready-for-human`.
