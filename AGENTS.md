# tuju-project

Bursa Malaysia intelligence platform — one web app, three products (see the Lean Model Canvas for the "why"). Leading with Product A: a one-stop dashboard with automated technical + fundamental analysis and IPO/prospectus document analysis.

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: root `CONTEXT-MAP.md` indexes a per-context `CONTEXT.md` at each workspace member (`apps/backend`, `apps/frontend`, `packages/contracts`, `services/ai`). System-wide ADRs stay in `docs/adr/`. See `docs/agents/domain.md`.
