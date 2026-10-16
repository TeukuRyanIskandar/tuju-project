# 13 — Exclude demonstrator news from real showcase coverage

Status: ready-for-human
Type: task
Blocked by: source/availability policy decision

## Evidence

The local `RssNewsAdapter` returns generated `Demo Wire` headlines and
`https://example.test/news/...` links, stored with `aggregator` lineage. The
2026-10-15 audit saw 2 items each for MAYBANK/CIMB and zero for 99SMART. A returned
08:00 UTC headline timestamp was later than the 04:28 UTC audit. These are not
verified media stories and cannot satisfy the showcase's real supporting-news
expectation. See [readiness.md](../readiness.md).

## Required decision and acceptance

Choose licensed/approved real source ingestion or explicitly unavailable news for
this showcase. Do not silently count generated snapshots as real coverage, invent
replacement articles or present example.test links as usable sources. If retained
for isolated testing, separate and label demonstrator data without claiming it
supports stock analysis. Re-audit company scope, actual publish dates and source
links; empty news must remain local and must not block TA/FA. No new scraping or
data-redistribution rights are implied by public accessibility.
