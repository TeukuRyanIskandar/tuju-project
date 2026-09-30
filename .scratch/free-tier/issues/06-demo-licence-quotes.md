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
