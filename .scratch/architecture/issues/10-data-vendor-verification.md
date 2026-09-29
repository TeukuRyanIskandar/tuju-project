# Task: verify Bursa / data-vendor licensing + coverage before contracting

Type: task
Status: claimed
Blocked by: (none)

## Question

The data-source research (ticket 09) recommended a hybrid posture but flagged
open items that can only be resolved by *contacting vendors / probing APIs* —
manual work that unblocks the final data-vendor commitment. Nothing to decide by
discussion here; the discussion is blocked until these facts exist.

HITL — mostly requires a human to request quotes / sign up. Agent can assist with
the FMP/Marketstack symbol probe (AFK-able) but the licensing items need the
human.

Must produce these facts (record them in the Answer on resolution — later
decisions/execution depend on them):

- **Bursa Information Services:** direct information-vendor licence fee + storage/
  redistribution terms (can we persist + display KLSE data; any per-pro-user fee).
- **EODHD commercial quote:** confirm the commercial licence permits **persisting
  + displaying KLSE** data in our product; price; any Bursa pro-user pass-through
  fees; turnaround (~3 business days per research).
- **Twelve Data (for the deferred live layer):** XKLS/Malaysia latency, the exact
  permitted cache window, Redistribution Rights Add-On price, and the
  delete-within-30-days-on-termination obligation confirmed.
- **FMP / Marketstack (backup coverage):** probe live symbols to confirm whether
  they actually cover KLSE (research left this UNVERIFIED).

Output: recorded facts (credential/quote locations, prices, confirmed terms) that
a later vendor-commitment + ingestion-execution effort depends on. This is
verification, not a decision on the route — it does not itself produce an ADR.

## Notes

Not on the critical path for the *architecture* destination (ADR-0004 already
fixed the data-layer *shape* regardless of which specific vendor is signed). This
ticket exists so the eventual executor isn't blocked; it can be worked in parallel
or deferred to the execution effort. Included because the research explicitly
surfaced it as required-before-contracting.

## Answer (partial — AFK item done; HITL items pending human)

### AFK item RESOLVED: FMP / Marketstack KLSE coverage probe

Live API probes require a key on every endpoint (FMP dropped the `demo` key;
Marketstack gates all endpoints behind `access_key`), so coverage was verified
against each vendor's **published, keyless coverage sources** instead — the
authoritative answer to the ticket's coverage question:

- **Marketstack — DOES NOT cover KLSE. (was UNVERIFIED → now verified NEGATIVE.)**
  Marketstack's public Stock Search page enumerates its full 70-exchange support
  dropdown. It lists regional peers — Jakarta (XIDX), Singapore (XSES), Bangkok
  (XBKK), Hong Kong (XHKG), Korea (XKRX) — but **Bursa Malaysia / XKLS is absent**.
  Also note: Marketstack **Free tier is Non-Commercial Use**; commercial use starts
  at the Basic plan (~US$8.99/mo billed yearly). → **Drop Marketstack as a KLSE
  backup.** Source: https://marketstack.com/search (supported-exchange list) and
  https://marketstack.com/product (pricing / non-commercial free tier).

- **FMP — DOES cover KLSE.** FMP's exchange enum includes code **`KLS`** (Kuala
  Lumpur) alongside JKT/SES/SET/HKSE; KLSE symbols use the `.KL` suffix
  (e.g. `5250.KL`, `6947.KL`, Maybank `1155.KL`). So FMP is a *viable* backup for
  KLSE prices. Caveat carried from research: FMP fundamentals are US-strong and its
  non-US depth is unverified for quality; treat as a **price/coverage backup only**,
  not a fundamentals source. FMP commercial licensing (persist/display rights for
  KLSE) is NOT yet confirmed — if FMP is ever promoted from backup to a relied-upon
  source, it inherits the same commercial-licence question as EODHD.
  Sources: FMP exchange-code enum incl. `KLS`
  https://docs.airbyte.com/integrations/sources/financial-modelling ;
  `KLS` = Kuala Lumpur Stock Exchange https://due.com/terms/kuala-lumpur-stock-exchange-kls/ ;
  `.KL` ticker format https://finance.yahoo.com/quote/6947.KL/ ;
  MIC `XKLS` https://www.tradinghours.com/mic/s/xkls .

**Net for the backup slot:** EODHD stays the documented anchor; **FMP (`KLS`/`.KL`)
is the confirmed backup for price coverage**; **Marketstack is ruled out** (no KLSE).

### HITL items PENDING — require the human (cannot be done AFK)

These three produce facts only obtainable by contacting vendors / signing up /
agreeing to terms. The agent cannot stand in for the human here. Precise checklist:

1. **Bursa Information Services** — email Bursa Market Data / Information Services
   (their web page blocks automated fetch, HTTP 403). Ask for: direct info-vendor
   licence fee schedule; whether we may **persist + display** KLSE data; any
   **per-professional-user** pass-through fee. Record: quote doc location + terms.
2. **EODHD commercial quote** — request via https://eodhd.com/commercial-pricing
   (~3 business days). Confirm: commercial licence permits **persist-in-Postgres +
   display-to-users for KLSE specifically**; price; any Bursa attribution /
   pro-user fee pass-through. Record: quote doc location + price + confirmed terms.
3. **Twelve Data** — for the *deferred* live layer only. Confirm with sales/docs:
   (a) XKLS real-time latency, (b) exact permitted **cache window** for XKLS,
   (c) **Redistribution Rights Add-On** price for a B2C dashboard, (d) the
   delete-within-30-days-on-termination obligation. Record: doc/quote locations.

Ticket stays `claimed` (not `resolved`): 3 of its 4 required facts do not yet exist
and only the human can produce them. Resolve this ticket once the three quotes/terms
are recorded above. This work is **off the architecture critical path** (ADR-0004
already fixed the data-layer shape) — it can be deferred into the execution effort.
