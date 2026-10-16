# 14 — Diagnose free-model output and artifact timestamp readiness blockers

Status: needs-triage
Type: bug
Blocked by: coordinator approval of scoped diagnosis/fix and further execution

## Evidence / impact

Approved local run on 2026-10-15 06:42–06:56 UTC used only `openrouter/free`.
Of 13 attempted TA/FA jobs, 4 landed facts_only and 9 failed terminally after
3 corrective retries: `Expecting value: line 1 column 1 (char 0)` at step
`narrate`. Failed TA: 6888, 6947, 1023, 5398, 5819; failed FA: 5326, 6888,
1023, 5819. 52 OpenRouter HTTP 200 responses were counted in worker logs;
HTTP success is not successful structured output. Root cause (empty content,
truncation, or other response incompatibility) is **not established**. No auth,
rate-limit or provider outage assertion is supported by these observations.

Additionally `GET /stocks/5326/analysis/technical/artifact` is HTTP 200 but
fails built `TechnicalAnalysisArtifact.omit({cost:true})` on two ISO datetimes:
`asOf: 2026-10-15 04:25:29.756000+00:00`,
`provenance.generatedAt: 2026-10-15 06:45:32.611010+00:00`.
Re-read twice at 06:57:19 UTC reproduced it. Envelope uses valid ISO asOf and
matches artifact symbol/jobName/time instant. Cost omission is intentional at
the proxy, not an additional defect. Artifact has an accurately labelled
facts-only grounding placeholder, not usable explanatory narration.

Code inspection lead (not a proven full diagnosis): `services/ai/src/tuju_ai/
artifacts.py:46` serializes via `json.dumps(..., default=str)`; inspect validated
model dump mode/serialization at pipeline-to-store boundary before proposing a
fix. No application files were changed in this run.

## Recommended bounded next step

- Authorize scoped offline diagnosis/regressions for validated-artifact JSON wire
  timestamps; confirm emitted artifacts satisfy TS schemas after intentional cost
  stripping, without relaxing ISO contracts.
- Authorize sanitized inspection of response metadata/length/finish reason and
  structured-output handling before another network run. Never log keys, prompts,
  full provider bodies or source pointers. Keep free-only routing; do not assume a
  different/paid model or invent narrative fallbacks.
- Agree explicit resume/ordering plan for 49 preserved waiting jobs, including
  two untouched prospectuses. Do not force-retry the nine failed jobs implicitly.
  Worker is stopped cleanly; 0 active/delayed. Full evidence in `../readiness.md`.

## Acceptance criteria

- Explain measured structured-output failures with sanitized evidence and bounded
  corrective handling; preserve terminal/facts-only semantics and cost controls.
- Stored/proxied TA/FA artifact timestamps pass actual contracts with a regression
  covering the validated model-to-S3 boundary.
- After separately approved execution, re-audit at least one complete stock and
  one prospectus, or record remaining shortfalls honestly. Tickets 11/13 are not
  resolved by this task; Part-1 PDF limitations must remain visible.
