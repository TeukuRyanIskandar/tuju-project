# 06 — Build prospectus at-a-glance reader

Status: ready-for-agent
Type: task
Blocked by: 02

## Goal

Render the existing rich prospectus capability per [the spec](../spec.md).

## Work

- Replace IPO placeholder using existing summary/artifact queries.
- Build concise first view: company/offer metadata, headline, business, offer
  highlights and what to watch; add anchored/expandable detail for all five sections.
- Render financial-period table and risk themes with textual severity.
- Render Shariah/source, cornerstone, optional lock-up and related-party insights.
- Show generation/source and extraction fallback/truncation limitations; keep
  cost/tokens/hashes/parser internals out of main presentation.
- Preserve financial strings; safely render model text without raw HTML or
  fabricated document links/citations. Include read refresh and back-to-market.

## Acceptance criteria

- Current artifact renders all five sections and supplied insights.
- Older artifact without optional insights remains usable with unavailable copy;
  absent findings are not asserted as document-level absence.
- Missing currency/offer fields and empty arrays get honest local states.
- Fallback/truncated sections expose limitations, source-section strings are not
  presented as verified page references.
- Summary remains when artifact fails; 404 is unavailable, never inferred progress.
- Changed/mismatched result metadata follows bounded coherence handling.

## Verification

Current/legacy fixture component tests, null/empty/truncation/routing cases,
text safety and partial failures; keyboard expand/anchor tests; typecheck/test.
