# Styling: Tailwind v4, shadcn, tokens, fonts

Type: task
Status: done
Blocked by: (none)

## Task

Implement `apps/frontend/DESIGN.md` in code.

- Install Tailwind v4 with `@tailwindcss/vite` and run `shadcn init`. Pin exact
  versions.
- Put every DESIGN.md token into `src/styles.css` (`@theme` plus shadcn semantic
  variables), including the shadcn mapping table. Our `--accent` must not be
  exported under shadcn's `--accent` name. Set the radius scale explicitly.
- Recheck shadcn's variable names when running `shadcn init`, as DESIGN.md asks.
- Self-host fonts with `@fontsource/ibm-plex-sans` and
  `@fontsource/jetbrains-mono`. No runtime calls to Google Fonts.
- Dark only. Honour `prefers-reduced-motion`. Base body text 13px.
- Update the "Status" paragraph of DESIGN.md.

## Done when

- `pnpm --filter @tuju/frontend build`, `typecheck` and `test` pass.
- No request to Google Fonts in the built output.
- A smoke test renders an element using a token-backed Tailwind utility.

## Comments

### Implementation note

**Files changed** (all under `apps/frontend` unless noted): `package.json`,
`vite.config.ts` (added `tailwindcss()` plugin), `src/styles.css` (rewritten),
`src/routes/__root.tsx` (`<html className="dark">`), `components.json` (new),
`src/lib/utils.ts` (new, `cn()`), `src/styles.test.tsx` (new smoke test),
`DESIGN.md` (Status paragraph), `../../pnpm-lock.yaml`.

**Versions installed (exact, no ranges):** tailwindcss 4.3.3, @tailwindcss/vite
4.3.3, @fontsource/ibm-plex-sans 5.3.0, @fontsource/jetbrains-mono 5.3.0, clsx
2.1.1, tailwind-merge 3.7.0, class-variance-authority 0.7.1. Fonts: latin subset,
weights 400/500/600 for both families (700 not used by the design). No change to
`allowBuilds` was needed. cva is installed for the first shadcn component; nothing
imports it yet.

**shadcn init:** ran `shadcn@4.21.3 init -t vite -b radix -p nova` in a scratch
project (not in the repo) to read current output. The CLI is interactive without
`-p`, writes an unpinned dependency set, replaces `styles.css`, and generates a
`button.tsx`. So the repo files were written by hand to match: `components.json`
(style `radix-nova`, css `src/styles.css`, aliases `@/*`), `cn()` with
clsx + tailwind-merge. No components added.

**Discrepancies vs the DESIGN.md mapping table / things to know:**
- shadcn now also expects `--sidebar*` variables (8 of them, plus `--color-sidebar*`).
  Not in DESIGN.md and not added, since there is no sidebar component yet. Add a
  mapping (likely surface-1 / fg / accent / surface-3 / border / accent) when the
  sidebar is first installed.
- shadcn's generated CSS also imports `tw-animate-css` and `shadcn/tailwind.css`
  (custom variants `data-open`, `data-closed`, etc. and accordion keyframes). Not
  added yet; the first component that needs them must add those two imports
  (pin `tw-animate-css` 1.4.0, `shadcn` 4.21.3).
- shadcn also emits `--font-heading` and `--radius-2xl..4xl`; not set. Tailwind
  defaults apply for 2xl and up.
- Naming clash: DESIGN.md lists `--radius` = 3px, but shadcn's `--radius` is its
  base (the table maps it to 4px). Resolved as `--radius: 4px` (shadcn base) and
  `--radius-md: 3px` (Tailwind `rounded-md`). Also added `--radius-xl: 6px`.
  DESIGN.md's "3px `--radius`" is therefore `rounded-md`.
- The `-foreground` names and the rest of the table match 4.21.3. `--accent` is
  mapped only at the Tailwind layer (`--color-accent: var(--surface-3)`), and raw
  `--accent` stays Tuju blue.
- Nova components use `ring-*` / `focus-visible:ring-3`, which Tailwind implements
  with box-shadow, and `outline-ring/50`. This conflicts with "no box-shadows" for
  shadcn components. Removed `shadow-*` utilities and added an unlayered
  `:focus-visible` outline, but `ring-*` is not disabled. Decide per component when
  adding them (likely strip ring classes in the copied component).
- Nova's `cn` import is `from "cn"` (a third-party npm package). Not used; standard
  `clsx` + `tailwind-merge` helper written instead.
- Added beyond DESIGN.md: `text-2xs` (11px), `text-body` (13px), `tracking-label`
  (0.09em), and the `num` utility (mono + tabular-nums).

**Verified (from `apps/frontend`, Node 24.16.0, pnpm 11.3.0):** `pnpm build`
passes (SPA prerender of `/`); `pnpm typecheck` passes after the build generates
the gitignored `routeTree.gen.ts` (it fails on a clean checkout before the first
build, pre-existing); `pnpm test` passes (66 tests across 2 files). No
`fonts.googleapis.com` or `fonts.gstatic.com` in `dist/`. Build output checked for
utilities: `bg-accent` -> `var(--surface-3)`, `bg-primary`, `text-up`, `num`,
`rounded-sm/md/lg`, `font-sans`/`font-mono`, `text-2xs`, `text-body`; `shadow-md`
is not generated. `_shell.html` has `<html lang="en" class="dark">`. Output dir is
`dist/` (no `.output`).

**Not verified:** no visual check in a browser (no dev server run, no screenshots);
font loading at runtime; focus ring and reduced-motion behaviour in a real browser;
the smoke test cannot prove Tailwind resolves colours in jsdom (the build check
above covers that). Node was not installed on this machine, so a temporary Node
24.16.0 download (sha256 verified) in the OS temp dir was used.
