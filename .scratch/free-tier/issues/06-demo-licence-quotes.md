# Task: ask EODHD / Twelve Data for a licence that permits a private demo

Type: task
Status: open
Blocked by: (none)

## Question

Research ([Research: KLSE market data sources for a private demo prototype](01-demo-market-data-sources.md)) found no self-serve tier that allows showing real KLSE prices to outside partners/investors. Get a concrete price + written terms so the demo-posture decision can weigh "real prices" against "synthetic prices".

HITL checklist (human sends; agent can draft the emails):

1. **EODHD B2B** (sales@eodhistoricaldata.com, or the WhatsApp link on https://eodhd.com/commercial-pricing): ask for a **Custom plan or written trial permission** covering "a non-public demo of a KLSE dashboard to a small number of named partners/investors". Also: is the 15–20 min delayed live snapshot populated for `.KLSE` tickers, and how deep is 5m/1h intraday for KLSE? Combine with the pending production quote in the architecture map's vendor verification task.
2. **Twelve Data Business** (https://twelvedata.com/pricing → For Business): quote for XKLS delayed/real-time + Redistribution Rights Add-On for a private demo, with the 20% startup discount.

Record: quotes (price, term, allowed audience, persistence rights), where the documents are saved, and any trial keys' location (never the key values).

Also ask EODHD: **KLSE fundamentals depth** (how many quarters of statements, freshness after a results announcement), because the screener derives ratios from them ([screener research](03-screener-and-indicator-data.md)). Also ask the pending **Bursa Information Services** enquiry (architecture vendor verification task) to include a **company-announcements feed** ([disclosure research](02-disclosure-and-news-sources.md)).

Not blocking [Decide: demo data posture](04-demo-data-posture.md): the synthetic path is viable without it. But the answer can change that decision, so revisit it if the quote arrives first.

## Comments

Drafted both outreach emails below, ready for a human to send (HITL — the agent
cannot send these). Status stays `open`: no quotes exist yet, only drafts.

### Draft 1 — EODHD B2B (sales@eodhistoricaldata.com)

> Subject: Custom/trial licence for a private KLSE dashboard demo — also a
> commercial-use quote
>
> Hello,
>
> We're building a Bursa Malaysia (KLSE) market-intelligence dashboard and are
> evaluating EODHD as our market-data vendor for both a near-term private demo
> and, pending that, a production commercial licence.
>
> **1. Private demo permission.** We'd like to show real KLSE prices to a small
> number of named partners and investors — not a public release. Our research
> into your personal/free-tier terms suggests this falls outside "internal use
> only," so we're asking about a **Custom plan, or written trial permission**,
> that explicitly covers "a non-public demo of a KLSE dashboard to a small
> number of named partners/investors." Could you confirm pricing and terms for
> this, or let us know what's needed to get written permission?
>
> **2. KLSE delayed/intraday coverage.** For `.KLSE` tickers specifically:
>   - Is the 15–20 minute delayed live snapshot populated for KLSE symbols?
>   - How deep does 5-minute and 1-hour intraday history go for KLSE?
>
> **3. Production commercial quote.** Separately (and this can be the same
> conversation/quote), we'd like a commercial-licence quote that confirms:
>   - The licence permits **persisting KLSE data in our own database and
>     displaying it to our users** (not just internal use).
>   - Price, and whether there's any Bursa attribution or per-professional-user
>     pass-through fee.
>   - Expected turnaround for the quote.
>
> **4. KLSE fundamentals depth.** For KLSE-listed companies: how many quarters
> of historical financial statements are available, and how quickly are
> fundamentals refreshed after a company's results announcement?
>
> Happy to hop on a call if that's easier. Thanks very much.

### Draft 2 — Twelve Data Business (via https://twelvedata.com/pricing → For Business)

> Subject: XKLS (Bursa Malaysia) quote for a private demo — Business plan +
> Redistribution Rights
>
> Hello,
>
> We're evaluating Twelve Data Business for a Bursa Malaysia (XKLS) market
> dashboard, starting with a private demo for a small number of named
> partners/investors before any public release. Could you provide a quote
> covering:
>
>   - **XKLS coverage**: delayed and/or real-time pricing availability and
>     latency for Bursa Malaysia (XKLS) symbols.
>   - **Redistribution Rights Add-On** pricing for a B2C-style dashboard that
>     displays this data to end users (we understand this is required beyond
>     the base Business plan for redistribution).
>   - The exact **permitted cache window** for XKLS data under this plan.
>   - Confirmation of the **delete-within-30-days-on-termination** obligation
>     for cached/stored data, so we can plan our retention accordingly.
>   - Whether the **20% startup discount** applies to this plan, and what's
>     needed to qualify.
>
> This is for a private demo in the near term, with production use a
> likely follow-on if terms work for us. Happy to provide more detail about
> our use case if useful. Thanks!

### Follow-up note for the pending Bursa Information Services enquiry

Per the architecture vendor-verification ticket
([10-data-vendor-verification](../../architecture/issues/10-data-vendor-verification.md)),
there's already a pending enquiry to Bursa Information Services about the
direct info-vendor licence. When following up on that thread, also ask
whether their feed includes a **company-announcements feed**
([disclosure research](02-disclosure-and-news-sources.md)) — no new email
drafted here since that enquiry is already in flight and this is additive to
it, not a new outreach.

### Recording quotes once received

Per this ticket's instructions, record (here, under a new `## Answer` heading)
once replies arrive: quote price, term, allowed audience, and persistence
rights for each vendor; where the quote documents are saved; and the location
of any trial keys (never the key values themselves).
