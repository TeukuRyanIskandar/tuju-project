# CI/CD pipeline shape: GitHub Actions → ECR → manual immutable-tag deploy

Status: accepted

## Context

The monorepo must be built, tested, and deployed under three locked structural
constraints:

- **Two-world build** (ADR-0002): pnpm + Turborepo for the TS half
  (`apps/frontend`, `apps/backend`, `packages/contracts`) and a separate
  uv-managed Python world (`services/ai`) outside the Turbo graph.
- **Deploy target** (ADR-0006): containers as docker-compose on a single EC2,
  RDS + S3 externalised, Terraform-provisioned, region ap-southeast-1, with an
  accepted single-EC2 SPOF / brief-reboot-downtime tradeoff.
- **Contract seam** (ADR-0007): `packages/contracts` is the single schema source
  generating both TS types and Python models; cross-language **contract drift**
  is the top structural risk flagged in ADR-0002.

## Decision

**GitHub Actions** is the CI host (repo is greenfield on GitHub; largest action
marketplace and best-documented OIDC-to-AWS path, which matters for a team new to
DevOps). GitLab was considered and rejected only on ecosystem-fit — splitting code
host from CI host adds friction for no gain at this stage.

**Contract source = Zod-first.** `packages/contracts` is authored in **Zod** (the
single source of truth). CI generates (1) TS types natively from Zod and (2) Python
**Pydantic** models via Zod's emitted **JSON Schema** through
`datamodel-code-generator`. This gives runtime validation on both ends (Zod on
NestJS, Pydantic on Python) with one source the TS-centric team enjoys editing.
Pydantic-first was the mirror alternative, rejected because the team's center of
gravity and the contract producer (NestJS) both sit in the TS world; Protobuf was
rejected as overkill for JSON-over-a-queue payloads.

**Contract-drift gate = check-in generated code.** Generated TS + Python are
committed. CI regenerates from the Zod source and **fails on any `git diff`**. Chosen
over build-time-only generation because the failing diff is a reviewable, teaching
signal and keeps generated artifacts inspectable, without making codegen a hard
dependency of every build/dev environment.

**Registry = ECR**, images tagged by **immutable git SHA** (plus a version tag on
release). All-AWS, IAM-native, Terraform already in the stack. **`:latest` is
forbidden in the compose file** — it destroys version choice and rollback.

**Deploy = manual for v1.** CI's responsibility ends at pushing SHA-tagged images to
ECR; **CI has zero prod access** (deliberate, given the team's low risk appetite).
A human deploys via **SSM Session Manager** (logged, no SSH keys/port): edit the
committed compose file to the desired tag, `docker compose pull && docker compose up -d`,
then hit the health endpoint. Steps live in a repo **runbook**.

**Trigger model (three lanes):**
- **PR** → lint + build + test both worlds (Turbo cache for TS; uv for Python, as a
  separate parallel job outside the Turbo graph) + contract-drift gate. No images, no deploy.
- **main** → all checks + build/push images to ECR tagged by git SHA.
- **tag `v*`** → generate release notes from **Conventional Commits** into a GitHub
  Release, and apply the version tag to the corresponding ECR images.

## Consequences

- **Version choice + rollback + prod record all hinge on one habit:** deploy only
  immutable, named tags recorded in a **committed compose file** (never `:latest`).
  The committed compose file *is* the authoritative record of what prod runs.
- **ECR lifecycle policy must keep the last ~30 images** so rollback targets survive
  (a too-aggressive cleanup would delete the version you need to roll back to).
- **Manual-deploy caveats accepted:** no automatic record of running version
  (mitigated by the committed compose file), human error / no gate on bad images
  (mitigated by the runbook + a post-deploy health check), config/secret drift if the
  box is hand-edited (mitigated by treating the committed compose + `.env.example` as
  source of truth; real secrets come from ticket 12's store), and manual downtime
  management (the brief container-swap gap is already an ADR-0006 accepted tradeoff).
- **Escape hatch:** automation upgrades to **SSM Run Command** later with *no change
  to the image-tagging model* — AWS runs the same predefined deploy script on the box
  (logged, IAM-scoped). Mirrors the ADR-0006 scale ladder: manual → SSM Run Command →
  orchestration.
- **Soft coordination with ticket 12 (secrets management):** CI and the deploy step
  consume whatever secret store that ticket picks; neither hard-blocks the other.
