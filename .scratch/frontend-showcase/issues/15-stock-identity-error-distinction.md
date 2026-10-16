# 15 — Distinguish unknown stock from core-read failure

Status: ready-for-agent
Type: task
Blocked by: none

## Problem

The showcase spec requires an unknown stock and a server failure to be
distinguishable while independently usable panels remain visible. The current
stock screen has generic core-read presentation, so the distinction is not yet
explicit.

## Work

- Present an unknown-stock response separately from a transient core-read failure.
- Preserve independent chart and analysis panel behaviour.
- Add focused component coverage for both states.

## Acceptance criteria

- A core 404 and a server/network failure have distinct, honest messages.
- A local core failure does not hide otherwise usable independent panels.
- No error state fabricates stock identity or analysis availability.

## Verification

Run focused frontend tests, then frontend typecheck and test.
