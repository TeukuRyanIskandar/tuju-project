# Decide: secrets management (store + rotation across three services)

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Decide the concrete secrets-management approach. ADR-0006 already leans on
**connection-URL-by-env config everywhere** (never hardcoded hosts) and
Terraform-provisioned AWS, but explicitly left the **secret store + rotation**
approach as fog. Pin it now.

Secrets in play across the three services + infra:
- DB connection (RDS), Redis, S3 credentials / IAM role.
- **Vendor API keys** (EODHD commercial, later Twelve Data / FMP) — see ticket 10.
- Session-signing / cookie secret (ADR-0005 opaque Redis sessions).
- Any CI/CD deploy credentials (coordinate with ticket 11).

Must settle:

- **Where secrets live at rest**: AWS Secrets Manager / SSM Parameter Store vs
  Terraform-managed env vars vs an `.env` on the box vs another store. Weigh against
  the single-EC2 + compose runtime (ADR-0006) and the all-AWS/Terraform posture.
- **How they reach each container** at runtime (env injection, mounted file,
  fetched-on-boot) without hardcoding — must stay consistent with the
  connection-URL-by-env invariant.
- **Rotation**: how a leaked/expired secret (esp. RDS creds, vendor keys) is rotated
  with minimal downtime given the single-EC2 SPOF tradeoff.
- **Local dev** (ADR-0006's `docker compose up`, LocalStack): how dev secrets are
  supplied without cloud access and without committing real secrets.
- What is committed vs never committed; how the boundary is enforced (e.g. secret
  scanning).

Output: an ADR recording the secret store, injection mechanism, rotation approach,
and the local-dev story.

## Notes

Graduated from the map's "Not yet specified" fog. Soft relationship with the CI/CD
ticket (CI needs deploy creds; the app needs runtime secrets) — coordinate, neither
hard-blocks the other. On the architecture critical path. Consult `grilling` +
`domain-modeling`.


## Answer

Recorded as [ADR-0009](../../docs/adr/0009-secrets-management-env-dev-ssm-prod-fetch-on-boot.md).

- **Store, split by environment:** gitignored `.env` (with committed `.env.example`
  of fake values) for **local dev**; **AWS SSM Parameter Store SecureString**
  (KMS-encrypted, IAM-scoped, free) for **prod**. Terraform provisions param
  names/paths only — values set out-of-band, never in TF state. **AWS Secrets
  Manager deferred** to scale (escape hatch, specifically RDS managed rotation).
- **Runtime injection = fetch-on-boot:** containers pull params via the EC2
  **instance role** (no static creds) and export them as env vars before start —
  secrets never touch disk, and the ADR-0006 connection-URL-by-env invariant holds
  (app still only reads `DATABASE_URL` etc.; SSM is just the prod source).
- **Local dev:** `.env` gitignored, no real secret ever committed or needed locally
  (local/prototyping runs on fixtures — the separate dev-data-posture effort).
- **Enforcement:** **gitleaks** secret-scanning gate on the ADR-0008 PR lane.
- **Rotation:** **none for v1** — manual replace-and-redeploy (containers re-fetch
  on boot; RDS password rotated in the same window), consistent with the single-EC2
  SPOF tradeoff. Managed rotation is the deferred Secrets Manager escape hatch.

Resolves the soft coordination with ticket 11 (CI/CD): CI uses OIDC (no long-lived
key); the app's runtime secrets come from SSM via the instance role. No new fog.
