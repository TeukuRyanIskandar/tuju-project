# Frontend foundation effort - Product A

Status: in-progress

## What this is

The execution effort that builds the shared foundation under every Product A
page: typed API access through `@tuju/contracts`, the DESIGN.md tokens, an app
shell with search, and the shared components. It is not a wayfinder map; it is an
ordered set of build tickets with blocking edges.

## Destination

A frontend where a new page can be written by calling a typed query function,
rendering shared components, and inheriting the shell. Page content (stock page,
market overview, screener, announcements, calendar, news, prospectus
at-a-glance) is out of scope and becomes separate feature efforts afterwards.

## Fixed inputs

- ADR-0002, 0004, 0005, 0007, 0008, 0011, 0013
- `apps/frontend/DESIGN.md`
- Free-tier specs 02-06 under `.scratch/free-tier-specs/`

## Decisions recorded

1. API response types live only in `@tuju/contracts`, written as Zod schemas. The
   frontend and backend both import them; neither keeps a copy.
2. HTTP schemas stay out of the Python codegen (`modelOrder`).
3. The prospectus at-a-glance artifact moves to Zod, and its Pydantic model is
   generated. The lenient models that parse raw LLM replies
   (`services/ai/.../analysis_models.py`) stay hand-written: they coerce messy
   input, which generated models cannot do.
4. The backend switches to the contracts types in this effort.
5. `docs/tokens-preview.html` is kept next to the `/_tokens` route.
6. No Tailwind/shadcn ADR; DESIGN.md holds that decision. One ADR (0014) covers
   the contracts scope change.
7. Response validation (`apiGet`) is on in dev and test and off in production
   builds (ticket 07). Warn-only in production is the later escape hatch once
   error reporting exists.

## Ticket order (blocking edges)

```
00 --> 01 --+--> 02 --> 03
00 --> 02   |
            +--> 05 --> 07 --+
04 ----------------------------+--> 09
06 --> 08 ---------------------+
06 --> 08 --> 10               |
07 -----------------------------+
```

00, 04 and 06 have no blockers and can run in parallel.

## Open questions

- Production SPA origin and shared parent domain (ADR-0005) for `CORS_ORIGINS`.
