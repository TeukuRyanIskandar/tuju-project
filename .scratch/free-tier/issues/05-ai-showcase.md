# Decide: how the free tier and the demo showcase AI capabilities

Type: grilling
Status: resolved
Blocked by: (none)

## Question

How do partners/investors (and later free users) **see our AI capabilities** without breaking ADR-0005's "free tier enqueues no user-triggered jobs"?

Candidate shapes (not mutually exclusive):
- **A. Demo accounts on a paid tier:** partners log in with a `pro`-tier demo account and see the real paid features. No free-tier change; needs the paid features to exist.
- **B. System-generated AI content for everyone:** trusted internal jobs (ADR-0005's system-caller path) precompute e.g. announcement summaries, an IPO prospectus "at a glance", or a daily market brief; free users read the cached results. Cost is bounded by us, not by users.
- **C. Metered free trial:** N AI runs per free user per period. Needs a quota dimension behind `can()`.

Decide: which shape(s), which **specific AI outputs** are showcased (and whether they exist yet or become new job types under ADR-0007), and whether ADR-0005 needs an amendment.


## Notes

- **User's steer (charting session):** wants to showcase AI capabilities to partners/investors.
- **Agent's suggested starting position (not decided):** A + B. Partners get `pro`-tier demo accounts to see real paid features, and system-generated AI content (e.g. IPO prospectus "at a glance", daily announcement summaries) is shown to everyone via the trusted system-caller path, so ADR-0005's free-tier rule stays intact. Grill this with the user; don't adopt it unilaterally.

## Answer

**Shape B (system-generated AI content for everyone via ADR-0005's trusted system-caller path). A and C rejected for this effort.**

- **A rejected:** "demo accounts see the *real* paid features" requires paid features to exist — **nothing exists yet** (confirmed with user). A is a promise, not a demo.
- **C rejected:** metered per-user free trial needs a quota dimension behind `can()` and still requires the AI features to exist; unnecessary complexity for a private demo. ADR-0005 stays intact — **no amendment needed**; everything runs on the existing system-caller path, cost bounded by us.

**What we showcase — a set: two shallow now + one deep, deferred.**

1. **Daily market brief** (shallow). *Caveat carried forward:* runs on the demo's **synthetic, "illustrative"-labelled** prices (demo-data-posture decision), so it must summarise movement in the synthetic series without dressing it as market truth. Open grilling point (not blocking): user's appetite for the brief given it narrates fake numbers.
2. **Announcement summaries** (shallow). Rides the **unlicensed aggregator snapshot** (demo-only; must be purged before public exposure). Keep on the safest available corpus.
3. **IPO prospectus "at-a-glance"** (deep, **deferred by design**). The flagship: 300–1000pp prospectuses, the "that would've taken me an afternoon" wow, and the **only artifact on real, clean, licence-safe data** (manually-curated stored PDFs — no synthetic prices, no aggregator). Deferred because it carries real ingestion engineering; user was saving it for later. Sections agreed: (1) offer — shares/price range/use of proceeds; (2) business in 3 lines; (3) key financials trend; (4) risk factors ranked/themed; (5) plain "what to watch".

**Design rationale:** one deep artifact on firm data beats three thin ones on shaky data — but user wants shallow breadth *now* while the deep one is built, so we keep both.

**Spawns:**
- [Research: best-in-class ingestion of 500–1000 page documents (beyond classic RAG)](08-long-document-ingestion.md) — user wants modern methods surveyed (long-context, layout-parse, hierarchical/agentic, contextual RAG, hybrid) before committing.
- [Decide: the IPO prospectus "at-a-glance" artifact (deep showcase, deferred)](09-prospectus-at-a-glance.md) — blocked by 08; fixes the ingestion approach, output contract, cost budget, and Bursa-specific insight.
