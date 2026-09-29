# Secrets management: gitignored `.env` for dev, SSM Parameter Store for prod, fetch-on-boot injection

Status: accepted

## Context

ADR-0006 fixed the runtime (single EC2 + docker-compose, RDS + S3 externalised,
all-AWS, Terraform-provisioned, `ap-southeast-1`) and established the
**connection-URL-by-env invariant**: every service reaches its dependencies by env
var (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT` + bucket), never hardcoded hosts.
ADR-0006 explicitly left the **secret store + rotation** approach as fog. ADR-0008
(CI/CD) gave CI **zero prod access**, made deploy manual via SSM Session Manager,
and named the committed compose file + `.env.example` as source of truth while
deferring "real secrets" to this ADR.

Secrets in play: RDS credentials, Redis, S3 access (via IAM role, not static keys),
vendor API keys (EODHD commercial, later Twelve Data / FMP — ticket 10), the
session-signing / cookie secret (ADR-0005 opaque Redis sessions), and CI deploy
credentials (OIDC to AWS per ADR-0008, so no long-lived key).

Constraints: lean launch, small team new to DevOps, low risk appetite, cost a
concern (~6–8 secrets at launch), all-AWS/IAM-native stack already in place.

## Decision

### Store — split by environment
- **Local dev: a gitignored `.env` file.** A committed **`.env.example`** carries
  fake/local values (LocalStack dummy creds, local Postgres password); each dev
  copies it to `.env` (gitignored). **No real secret is ever committed, and none
  needs to exist locally** — local dev / prototyping runs on fixtures (owned by the
  separate dev-data-posture effort), so real vendor keys never land on a dev box.
- **Prod: AWS SSM Parameter Store (SecureString), KMS-encrypted, IAM-scoped.**
  Chosen over Secrets Manager because standard SecureString params are **free**,
  fit the existing Terraform + IAM + KMS posture, and cover every secret Product A
  has at launch. Terraform provisions the parameter *names/paths* (not values);
  values are set out-of-band so they never enter Terraform state.
- **AWS Secrets Manager is deferred** to the scale step — the pre-identified escape
  hatch specifically for **RDS managed rotation** once scale justifies its
  per-secret cost.

### Runtime injection — fetch-on-boot
- Containers **fetch their secrets on boot** (e.g. `aws ssm get-parameters-by-path`
  in an entrypoint, exported as env vars before the app starts), authenticated by
  the **EC2 instance role** — no static AWS credentials, and secrets **never touch
  disk**. This honours the ADR-0006 connection-URL-by-env invariant: the app still
  only ever reads `DATABASE_URL` etc. from its environment; SSM is merely where
  those values are sourced in prod (vs. the `.env` file locally). The interface is
  identical across environments; only the source differs.

### Enforcement
- A **secret-scanning CI gate (gitleaks)** runs on the ADR-0008 PR lane, failing the
  build on any committed secret. Makes "never commit real secrets" enforced, not
  aspirational.

### Rotation — none for v1
- **No automated rotation at launch.** A leaked or expired secret is handled
  **manually**: update the SSM parameter, redeploy (containers re-fetch on boot);
  for RDS, rotate the DB user password in the same redeploy window. Consistent with
  the ADR-0006 single-EC2 SPOF tradeoff (brief restart downtime already accepted).
  Automated/managed rotation arrives with the Secrets Manager escape hatch at scale.

## Consequences

- **Prod secrets live only in SSM + KMS + process memory** — never in git, never in
  Terraform state, never on the box's disk. The instance role is the single grant
  that must be scoped tightly (least-privilege to the app's parameter path).
- **Adding a secret is uniform:** put a SecureString in SSM (prod) + a fake line in
  `.env.example` (dev); the fetch-on-boot script and the connection-URL-by-env
  contract mean no code path changes.
- **Accepted for launch:** manual rotation (mitigated by the redeploy runbook and
  the low blast radius of ~8 secrets), and a boot-time dependency on SSM
  availability (a failed fetch fails the container start loudly, rather than running
  with stale/missing secrets).
- **Escape hatch, no rewrite:** because the app only consumes env vars, migrating
  any secret (RDS first) to **Secrets Manager with managed rotation** later swaps the
  fetch source, not the app — mirroring the ADR-0006 / ADR-0008 "manual now,
  automated at scale" ladder.
