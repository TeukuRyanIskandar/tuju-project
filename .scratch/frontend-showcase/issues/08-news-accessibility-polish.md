# 08 — Add supporting news and cross-screen accessibility polish

Status: ready-for-agent
Type: task
Blocked by: 03, 04, 05, 06, 07

## Goal

Complete usable, consistent screens without expanding into full dashboard tools.

## Work

- Stock-scoped news list, max five latest: title/source/date/source link using
  existing API. Honest empty and independent failure states.
- Audit all three screens against DESIGN.md: units, tabular numbers, AI/source
  labels, private-demo restrictions, dates, state copy and local read retries.
- Check semantic headings/tables, keyboard/focus, chart table fallbacks, textual
  status cues, reduced motion and labelled expandable regions.
- Desktop composition and 390px stacking; confine wide tables to labelled scroll
  containers. Render source links safely; hide infrastructure error internals.

## Acceptance criteria

- Empty/failed news does not affect chart or analysis; news is distinct from AI.
- Both journeys can be completed keyboard-only with visible focus and sensible
  heading/focus order; data is accessible beyond hover and colour.
- At 390px no page-level horizontal overflow; wide financial tables remain usable.
- Mixed sources, result dates and missing quote times are labelled consistently.
- Refresh errors retain clearly marked cached data where available.

## Verification

Component tests for news/links/states and keyboard controls; manual desktop and
narrow-view review. Record manual limitations instead of claiming full WCAG
certification; typecheck/test/build.
