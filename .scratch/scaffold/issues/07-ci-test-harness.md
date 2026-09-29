# Scaffold: CI (GitHub Actions) + drift gate + testcontainers integration harness

Status: done
Done in: 98b48b2
Blocked by: 06
Implements: ADR-0008, ADR-0009, ADR-0011

## Task

Wire CI to match ADR-0008's three lanes and ADR-0011's test layers. No prod access
(ADR-0008: CI stops at pushing images).

- **GitHub Actions** workflows. Two build worlds as separate parallel jobs: TS
  (pnpm + Turbo cache) and Python (uv, outside the Turbo graph).
- **PR lane:** lint + typecheck + build both worlds; **unit + contract tests**; the
  **contract-drift gate** (regenerate from Zod v4 source, fail on `git diff`, per
  ADR-0008 / ticket 02); **gitleaks** secret-scan gate (ADR-0009). No images, no deploy.
- **Integration lane:** spin up **testcontainers** (Redis + Postgres + LocalStack)
  and run the ADR-0011 integration suites against them (JobBus round-trip; NestJS→
  Postgres sole-writer path). Docker-in-CI required (GH runners have it).
- **main lane:** all checks + build & push images to **ECR**, tagged by immutable git
  SHA (`:latest` forbidden), via OIDC-to-AWS. (Requires the ECR repo + OIDC role —
  provisioned by Terraform in a later infra step; CI job can be authored now and
  gated/skipped until infra exists.)
- **tag `v*` lane:** Conventional-Commits release notes → GitHub Release + version-tag
  the ECR images.
- **Test harness finalisation:** the golden-fixture conformance tests (ticket 02) run
  on both sides; TA/FA market-realism tests are **skippable-with-a-marker** until the
  dev-data effort delivers fixtures (ADR-0011).

## Done when

PR lane passes green on the scaffolded repo (unit + contract + drift gate + gitleaks);
the integration lane brings up testcontainers and the round-trip test passes in CI; the
main/tag lanes are authored (image push may be gated behind not-yet-provisioned ECR).

## Notes

Deploy itself is manual via SSM (ADR-0008) — NOT part of CI and NOT part of this
scaffold. Terraform infra (RDS/S3/ECR/OIDC/SSM params) is its own later effort; this
ticket authors the CI that consumes it and can gate the AWS-touching steps until it
exists.
