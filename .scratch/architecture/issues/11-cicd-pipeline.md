# Decide: CI/CD pipeline shape (two-world build → EC2/compose deploy)

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Decide the CI/CD pipeline shape for the monorepo, given the locked structural
decisions it must serve:

- **Two-world build** (ADR-0002): pnpm + Turborepo for the TS half (`apps/frontend`,
  `apps/backend`, `packages/contracts`); a separate **uv-managed Python world**
  (`services/ai`) outside the Turbo graph. CI must build/test both and cannot lean
  on Turbo to see the Python side.
- **Deploy target** (ADR-0006): containers running as **docker-compose on a single
  EC2**, with RDS + S3 externalised, Terraform-provisioned, region ap-southeast-1.
- **Contract seam** (ADR-0007): `packages/contracts` is the single schema source
  generating both TS types and Python models — CI is the natural place to **enforce
  no contract drift** (the top structural risk flagged in ADR-0002).

Must settle:

- CI host/platform (GitHub Actions vs alternative) and why.
- Build & test stages for each world; how Turbo caching is used for the TS half and
  how the Python world is built/tested alongside it.
- **Contract-drift guard**: does CI regenerate TS+Python from `packages/contracts`
  and fail on a diff? Where does that gate live in the pipeline?
- Container build + registry (which registry; how images are tagged/versioned).
- Deploy mechanism to the single-EC2 compose target (push-based vs pull-based; how
  the compose file/images land on the box; zero/brief-downtime given the accepted
  single-EC2 SPOF tradeoff in ADR-0006).
- Branch/trigger model (what runs on PR vs main vs tag/release).

Output: an ADR recording the pipeline shape + the concrete stage list an executor
can wire.

## Notes

Graduated from the map's "Not yet specified" fog once ADR-0006 gave it a concrete
deploy target. Soft relationship with the Secrets-management ticket: CI consumes
whatever secret store that ticket picks — coordinate, but neither hard-blocks the
other. On the architecture critical path: an executor cannot scaffold a working
repo without knowing the pipeline shape. Consult `grilling` + `domain-modeling`.


## Answer

**CI/CD pipeline shape pinned** ([ADR-0008](../../docs/adr/0008-cicd-github-actions-ecr-manual-deploy.md)).

- **Host/CI:** GitHub + **GitHub Actions** (greenfield on GH; largest action marketplace + best-documented OIDC-to-AWS path). GitLab rejected on ecosystem-fit only.
- **Contract source:** **Zod-first** — `packages/contracts` authored in Zod (single source); CI generates TS types natively + Python **Pydantic** via emitted **JSON Schema** (`datamodel-code-generator`). Runtime validation both ends. Pydantic-first / Protobuf rejected.
- **Contract-drift gate:** **check-in generated code** — generated TS+Python committed; CI regenerates from Zod and **fails on `git diff`**. Chosen over build-time-only gen (reviewable teaching signal; no hard codegen dependency in every env).
- **Registry:** **ECR**, images tagged by immutable **git SHA** (+ version tag on release). `:latest` **forbidden** in the compose file.
- **Deploy:** **manual v1** — CI ends at pushing SHA-tagged images to ECR; **CI has zero prod access**. Human deploys via **SSM Session Manager** (logged, no SSH keys): edit committed compose file to desired tag, `docker compose pull && up -d`, health-check. Runbook in repo. Version choice + rollback + prod-record all hinge on: **deploy immutable named tags recorded in a committed compose file, never `:latest`**. ECR lifecycle keeps last ~30 images for rollback. **Escape hatch:** SSM Run Command automates the on-box steps later with no change to the tagging model (mirrors ADR-0006 ladder: manual → SSM Run Command → orchestration).
- **Triggers:** **PR** → lint+build+test both worlds (Turbo cache TS; uv Python as separate parallel job outside Turbo graph) + contract-drift gate, no deploy. **main** → checks + build/push images to ECR (git SHA). **tag `v*`** → release notes from **Conventional Commits** → GitHub Release + version-tag the ECR images.
- **Soft coordination with ticket 12 (secrets):** CI/deploy consume whatever store ticket 12 picks; no hard block either way.

No new fog surfaced; no scope changes. Sibling frontier tickets 12/13/14 unaffected.
