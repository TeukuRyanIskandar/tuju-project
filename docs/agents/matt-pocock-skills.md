# Matt Pocock Skills

This repository vendors the complete `skills/` tree from [mattpocock/skills](https://github.com/mattpocock/skills), pinned to commit [`49dd158d1076134a641b33efb035946536778336`](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336). The snapshot is MIT-licensed; see [the copied license](../../.opencode/skills/LICENSE). It is a project-local, editable snapshot, not an auto-updating plugin. Upstream updates require a deliberate review and refresh of this pinned copy and its adaptations.

## Restoring the snapshot

`.opencode/` is gitignored as a local agent runtime, so **a fresh clone has no
skills and no license file** — including the one this document links to. Restore
the pinned snapshot before expecting any skill to be discoverable:

```bash
PIN=49dd158d1076134a641b33efb035946536778336
git clone https://github.com/mattpocock/skills /tmp/mattpocock-skills
git -C /tmp/mattpocock-skills checkout "$PIN"
mkdir -p .opencode/skills
cp -Rn /tmp/mattpocock-skills/skills/. .opencode/skills/
cp -n /tmp/mattpocock-skills/LICENSE .opencode/skills/LICENSE
rm -rf /tmp/mattpocock-skills
```

Upstream's `skills/` becomes `.opencode/skills/` and its root `LICENSE` becomes
`.opencode/skills/LICENSE`, which is where the link above points. This copies 38
`SKILL.md` files. `.opencode/plans/` is already tracked and needs no restoring.
Restart OpenCode afterwards, then confirm discovery with `opencode debug skill`.

`-n` (no-clobber) is deliberate: **26 of the files in the working tree carry
local adaptations**, mostly upstream's `GLOSSARY.md`/`GLOSSARY-MAP.md` pointers
rewritten to this repo's `CONTEXT-MAP.md` and workspace `CONTEXT.md`, plus
`.scratch` tracker paths. A plain `cp -R` would silently revert them to upstream
text. To re-vendor from a newer `PIN`, delete `.opencode/skills/` first and
re-apply the adaptations recorded below.

## Installed inventory

All upstream skill directories are copied under `.opencode/skills/<bucket>/<skill>/`, including their referenced assets. The categories below describe upstream status at the pinned revision; the presence of an experimental or miscellaneous skill does not imply it is endorsed for routine use.

- **Engineering (20):** `ask-matt`, `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-with-docs`, `implement`, `implement-spec`, `improve-codebase-architecture`, `pr`, `prototype`, `research`, `retro`, `setup-matt-pocock-skills`, `tdd`, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `wizard`.
- **Productivity (7):** `grill-me`, `grilling`, `handoff`, `teach`, `to-questionnaire`, `wait-what`, `writing-for-agents`.
- **Misc (4):** `git-guardrails-claude-code`, `migrate-to-shoehorn`, `scaffold-exercises`, `setup-pre-commit`.
- **In progress (7; experimental):** `chief-of-staff`, `claude-handoff`, `loop-me`, `setup-ts-deep-modules`, `writing-beats`, `writing-fragments`, `writing-shape`.
- **Deprecated:** no `SKILL.md` exists in this bucket at the pinned revision (upstream provides only its bucket README).

There are 38 `SKILL.md` files across the four populated buckets. OpenCode v1.18.35 discovers nested `.opencode/skills/**/SKILL.md` files. Its skill loader reads `name` and `description`; upstream `disable-model-invocation` metadata is not enforced by this runtime, so do not rely on that metadata to prevent automatic selection. The root `AGENTS.md` and this guide remain authoritative. Restart OpenCode after adding/updating skills; use `opencode debug skill` to inspect discovery.

## Local authority and compatibility

This vendor snapshot is subordinate to the root `AGENTS.md` and the existing repository docs. A skill call is not approval to write, delegate, publish, or change scope. Imported skills must not launch background, parallel, or nested agents. Commits and pushes always require a separate explicit user request, even if an imported skill suggests or includes those steps.

The upstream set assumes `GLOSSARY.md`/`GLOSSARY-MAP.md`; this repository instead uses root `CONTEXT-MAP.md`, the relevant workspace member `CONTEXT.md`, and applicable ADRs in `docs/adr/` (see `docs/agents/domain.md`). Do not create a glossary system to satisfy imported instructions. Issue/ticket operations use local Markdown under `.scratch/<feature-slug>/`, with the spec, individual numbered issue files, and five triage labels described in `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`. Do not assume GitHub/GitLab APIs or create external tracker artifacts.

Adaptations to imported operational instructions:

- User-invoked orchestration skills must not launch background, parallel, or nested agents.
- Do not create branches or push/commit work just because an imported skill recommends it. Respect this repo's separate explicit authorization for commits/pushes.
- Domain vocabulary and ADR discovery use the repository's `CONTEXT*` map/member files and ADRs, not upstream glossary filenames.
- Where an upstream flow assumes an external tracker, follow the local `.scratch` issue tracker docs; unsupported external-tracker actions must be proposed rather than carried out.
- Skills in `in-progress/` are upstream experiments. Miscellaneous skills may target environments not used here (for example, Claude Code hooks); inspect applicability and propose changes instead of applying irrelevant setup.

These constraints intentionally preserve upstream skill content while overriding repository-incompatible execution mechanics. If a skill's remaining instructions cannot be reconciled with these rules, stop and ask rather than broadening scope.
