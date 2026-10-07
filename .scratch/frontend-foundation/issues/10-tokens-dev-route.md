# `/_tokens` dev route

Type: task
Status: ready-for-agent
Blocked by: 06, 08

## Task

- Rebuild the content of `apps/frontend/docs/tokens-preview.html` in React with
  the real tokens and components.
- Available only in dev builds.
- Keep `docs/tokens-preview.html`. Update the DESIGN.md "Preview" section to say
  both exist and that `/_tokens` is the reference, since it uses the real
  `styles.css` and the HTML file can drift.

## Done when

The route renders in dev and is absent from the production build.

## Comments
