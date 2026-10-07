# Design: Frontend (`@tuju/frontend`)

Visual language for Product A. Direction: **dense, terminal-style, dark-first**.
Think a data terminal, not a marketing site: compact rows, monospace numbers,
hairline borders, one accent, no shadows.

**Status:** tokens are agreed but **not yet implemented**. `src/styles.css` is
still the scaffold placeholder. The next step is to move these values into
`styles.css` (Tailwind v4 `@theme` + shadcn semantic variables). Token names
below are the contract; keep them when implementing.

**Stack (decided):** Tailwind v4 + shadcn/ui. shadcn's semantic names
(`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, ...)
map onto the tokens below so shadcn components pick up the theme.

## Principles

1. **Density over air.** 26px table rows, 28px controls, 13px body text.
2. **Numbers are monospace and tabular.** Every price, percentage, volume and
   index level uses the mono font with `font-variant-numeric: tabular-nums`.
3. **Depth from lightness, not shadow.** Surfaces step lighter; 1px hairlines
   separate them. No box-shadows.
4. **One accent, used sparingly.** Blue, reserved for active tab, focus ring,
   selection and the primary action. Nothing else (the wordmark is `--fg`, not
   accent).
5. **Market colour is not status colour.** Up/down green and red mean price
   movement only. Danger, warn and info are separate tokens. `--down` and
   `--danger` are close in hue, so what keeps a "danger" banner from reading as
   a price drop is its icon, label and left-border layout, not the colour. Never
   use `--danger` for a number and never use `--down` for a banner.
6. **Colour is never the only signal.** Price changes carry a sign and arrow.
   Status banners carry an icon and label. Provenance tags carry text.
7. **Provenance is always visible.** AI-generated and synthetic/demo content
   is tagged (both free-tier specs require it).
8. **Motion is functional.** Tick flash and hover only. Honour
   `prefers-reduced-motion`.

## Colour tokens

Dark only for v1. Adding a light theme later means re-declaring the same
variables under a different selector; it should not need component changes.

### Surfaces and borders

| Token | Value | Use |
| --- | --- | --- |
| `--surface-0` | `#0b0d10` | App background |
| `--surface-1` | `#111418` | Panel |
| `--surface-2` | `#171b21` | Raised: table header, panel header |
| `--surface-3` | `#1e232b` | Hover / selected row |
| `--border` | `#262c35` | Hairlines between and inside panels |
| `--border-strong` | `#343c47` | Decorative dividers only (fails 3:1 on panels) |
| `--control-border` | `#6a7484` | Input and button outlines (>= 3:1 on every surface incl. hover, WCAG 1.4.11) |

### Text

| Token | Value | Use |
| --- | --- | --- |
| `--fg` | `#e6e9ee` | Primary |
| `--fg-2` | `#a3abb8` | Secondary |
| `--fg-3` | `#8c95a5` | Muted: metadata, captions, disabled-ish labels |

### Accent

| Token | Value | Use |
| --- | --- | --- |
| `--accent` | `#5b9bff` | Active tab, focus ring, selection, primary button |
| `--accent-fg` | `#06101f` | Text on an accent fill |
| `--accent-soft` | `rgba(91,155,255,.15)` | Selected row / active timeframe background |

`--fg-3` was `#7d8696` and failed 4.5:1 on hover rows (4.30), selected rows
(4.04) and the AI card (4.46). It is now `#8c95a5`, which passes on all of them.

Amber (`#f5a524`) was tried first and dropped: on near-black it reads as a
different kind of site. Do not reintroduce yellow/orange as a UI accent.
Orange remains fine as a **chart series** colour.

### Market

Bursa convention: green up, red down.

| Token | Value |
| --- | --- |
| `--up` / `--up-bg` / `--up-border` | `#26d07c` / `rgba(38,208,124,.12)` / `rgba(38,208,124,.35)` |
| `--down` / `--down-bg` / `--down-border` | `#ff6b6b` / `rgba(255,107,107,.12)` / `rgba(255,107,107,.35)` |
| `--unch` / `--unch-bg` | `#8b94a3` / `rgba(139,148,163,.12)` |
| `--tick-flash-up` / `--tick-flash-down` | `rgba(38,208,124,.28)` / `rgba(255,107,107,.28)` |

Tick flash is a 600ms fade on a changed cell, disabled under reduced motion.
Red-up (East Asian convention) as a user setting is **not decided**; if it is
added, swap `--up`/`--down` at the root, never hard-code green/red in
components.

### Status

| Token | Value | Use |
| --- | --- | --- |
| `--info` | `#9fb3c8` | Neutral notices (steel, deliberately not the accent blue) |
| `--warn` | `#ffd166` | e.g. "Delayed 15 minutes" |
| `--danger` | `#ff4d6d` | e.g. "Trading suspended" |

Always rendered with an icon and a text label.

### Provenance

| Token | Value | Treatment |
| --- | --- | --- |
| `--ai` / `--ai-bg` | `#b39bff` / `rgba(179,155,255,.12)` | Solid violet border/badge: "AI summary" |
| `--synthetic` / `--synthetic-bg` | `#5ad1e6` / `rgba(90,209,230,.10)` | **Dashed** cyan border/badge: not live market data |

### Chart series

Six colours, based on the Okabe-Ito palette (chosen for colour-vision
deficiency), lifted for dark backgrounds.

`--chart-1` `#56b4e9` | `--chart-2` `#e69f00` | `--chart-3` `#b26d3e` |
`--chart-4` `#f0e442` | `--chart-5` `#cc79a7` | `--chart-6` `#b0b7c3`

Rules:
- Max 4-5 series on one chart.
- Add a second cue beyond colour (dash style, direct end labels, markers).
- Price up/down in OHLC and volume uses `--up` / `--down`, not chart series.
- Price line = `--chart-1`; moving average = `--chart-2`.

Changes from v0: the old chart-3 (`#00c48c`) was too close to `--up`, and the
old chart-7 (`#8fa3ff`) too close to `--ai`, so a chart line could read as "price
up" or "AI content". Both were removed, and the old orange chart-6 (confusable
with chart-2) became the copper `--chart-3`.

**Checked** (CIEDE2000 under normal vision and simulated deuteranopia,
protanopia and tritanopia, Machado 2009 matrices): every chart pair is at least
8.6 apart in the worst case. All six have at least 4.5:1 against `--surface-1`
(graphics need 3:1).

**Known near-matches with semantic colours** (worst-case dE under 6, so someone
with colour-vision deficiency cannot tell them apart by colour):
- `--chart-1` and `--ai` (3.1), `--chart-1` and `--accent` (5.8)
- `--chart-5` and `--unch` (2.6)
- `--chart-4` and `--warn` (4.1), `--chart-6` and `--info` (4.0)

Do not place a chart series next to its near-match without a label or marker.
Not checked: real users or other simulator models.

## shadcn and Tailwind v4 mapping

Token names above are the source of truth. shadcn components expect their own
names, and two of them clash: in shadcn, `--accent` is the subtle **hover
surface** (menu items, ghost buttons) and the brand colour is `--primary`. So
our `--accent` must not be exported under the shadcn name `--accent`, or every
dropdown hover becomes bright blue.

| shadcn variable | Tuju token | Note |
| --- | --- | --- |
| `--background` / `--foreground` | `--surface-0` / `--fg` | |
| `--card`, `--popover` (+ `-foreground`) | `--surface-1` / `--fg` | |
| `--primary` / `--primary-foreground` | `--accent` / `--accent-fg` | Brand blue |
| `--secondary` / `--secondary-foreground` | `--surface-2` / `--fg` | |
| `--muted` / `--muted-foreground` | `--surface-2` / `--fg-3` | |
| `--accent` / `--accent-foreground` | `--surface-3` / `--fg` | Hover surface, **not** our blue |
| `--destructive` | `--danger` | |
| `--border` | `--border` | |
| `--input` | `--control-border` | |
| `--ring` | `--accent` | |
| `--radius` | `--radius-lg` (4px) | shadcn derives sm/md/xl from this; set the scale explicitly so `sm` stays 2px |
| `--chart-1` ... `--chart-5` | `--chart-1` ... `--chart-5` | shadcn has five; `--chart-6` is ours |

Tailwind v4 only generates utilities for variables exposed in `@theme` with
the right namespace, so each token also needs one of these:

- Colours: `--color-up`, `--color-down`, `--color-unch`, `--color-ai`,
  `--color-synthetic`, `--color-warn`, `--color-info`, `--color-fg-2`,
  `--color-fg-3`, `--color-surface-0` ... `--color-surface-3`, and so on, written
  as `@theme inline { --color-up: var(--up); }` so the dark/light swap stays in
  `:root`.
- Fonts: `--font-ui` -> `--font-sans`, `--font-mono` stays.
- Radius: `--radius-sm`, `--radius-md`, `--radius-lg`.

The shadcn names above were taken from the shadcn theming docs on 2026-10-07;
recheck when running `shadcn init`.

## Typography

| Token | Value |
| --- | --- |
| `--font-ui` | IBM Plex Sans, then `ui-sans-serif, system-ui, sans-serif` |
| `--font-mono` | JetBrains Mono, then `ui-monospace, "SF Mono", Menlo, monospace` |

Fonts are **self-hosted via `@fontsource`** in production. No runtime calls to
Google Fonts. (The preview page used Google Fonts for convenience only.)

Scale (px): 11 (uppercase section labels, +0.09em tracking; also the minimum
size for any text, badges and `kbd` included), 12 (secondary,
captions), **13 (default body)**, 14, 16 (panel titles), 20 (page title).
Line height is tight (about 1.4 for body). Table headers are 11px uppercase.

## Shape and density

| Token | Value |
| --- | --- |
| `--radius-sm` / `--radius` / `--radius-lg` | 2px / 3px / 4px |
| `--row-h` | 26px (table body rows; header rows 24px) |
| `--control-h` | 28px (buttons, inputs) |
| `--motion-fast` | 150ms (hover/background transitions) |

Spacing base is 4px. Panels are a 30px header (`--surface-2`, uppercase 11px
label) over a `--surface-1` body, 1px `--border`, 4px radius.

## Component patterns

- **Change chip:** mono, 18px tall, tinted background from `--up-bg` /
  `--down-bg` / `--unch-bg`, always a sign and an arrow (`▲ +1.24%`). Only for price and index
  movement; volume and other counts are plain text, never a change chip.
- **Tables:** mono right-aligned numeric columns, symbol in bold mono with the
  company name in `--fg-3`. Hover `--surface-3`. Selected row: `--accent-soft`
  fill plus a 2px inset accent bar on the left.
- **Index strip:** label (11px caps, `--fg-3`), value (15px mono 600), change chip.
- **Tabs:** 2px accent underline on the active tab.
- **Buttons:** primary = accent fill with `--accent-fg` text; default =
  `--surface-2` with `--control-border`; ghost = transparent.
- **Focus:** 2px `--accent` outline with 1px offset, on every interactive element.
- **Alerts:** `--surface-1` with a 3px coloured left border, an icon and a bold label.
- **Provenance:** AI = solid violet container; synthetic = dashed cyan container.
  Both carry a text badge.
- **Shortcuts:** show as `<kbd>` (mono 11px, 2px bottom border).

### Charts (TradingView-style)

Two reference charts exist in the preview: a **line chart** and an **OHLC bar
chart**. Shared structure:
- Price axis on the **right**; horizontal and vertical gridlines in `--border`.
- **Last-price tag** on the axis in the up/down colour (line chart: series
  colour), with a dashed line across at the last price.
- **Volume pane** below the price pane, bars tinted up/down at about 45% opacity.
- **Crosshair** on hover: dashed lines, price tag on the axis, date tag at the
  bottom; the legend above the chart updates to the hovered bar (O/H/L/C or
  C, change, MA, volume).
- Line chart: 2px `--chart-1` line over a soft gradient fill, 1.25px
  `--chart-2` 20-day MA.
- Bar chart: left tick = open, right tick = close, colour by close vs open.
  Colour is the only up/down cue in this form; consider candlesticks with
  filled vs hollow bodies as a second cue.
- Timeframe buttons (1W 1M 3M 6M 1Y): active state uses `--accent` on
  `--accent-soft`.

## Accessibility: what was checked

Contrast was computed with the WCAG relative-luminance formula on the final
values (text pairs need 4.5:1, UI boundaries and graphics 3:1). Semi-transparent
fills (`--accent-soft`, `--ai-bg`, `--up-bg`, ...) are blended onto their parent
surface first, because text sits on the blended colour, not on the flat surface.
The preview's live table does the same blend.

| Pair | Ratio |
| --- | --- |
| `--fg` on `--surface-0` / `--surface-1` | 15.99 / 15.17 |
| `--fg-2` on `--surface-1` / selected row | 7.98 / 6.41 |
| `--fg-3` on `--surface-0` / `-1` / `-2` / `-3` | 6.45 / 6.12 / 5.73 / 5.23 |
| `--fg-3` on selected row / AI card / synthetic card | 4.91 / 5.05 / 5.09 |
| `--up` on `--surface-1` / hover row / `--up-bg` chip | 9.14 / 7.81 / 7.42 |
| `--down` on `--surface-1` / hover row / `--down-bg` chip | 6.66 / 5.69 / 5.71 |
| `--unch` on `--surface-1` / hover row / `--unch-bg` chip | 6.04 / 5.16 / 5.14 |
| `--accent` on `--surface-1` / selected row / active timeframe | 6.66 / 5.35 / 4.94 |
| `--accent-fg` on `--accent` | 6.88 |
| `--info` / `--warn` / `--danger` on `--surface-1` | 8.58 / 12.81 / 5.75 |
| `--ai` on `--ai-bg`, `--synthetic` on `--synthetic-bg` | 6.57 / 8.56 |
| `--surface-0` text on last-price tag (up / down / chart-1) | 9.63 / 7.01 / 8.43 |
| `--control-border` on `--surface-0` / `-1` / `-2` / `-3` | 4.12 / 3.91 / 3.66 / 3.34 |

Chart palette: see "Chart series" above for the colour-blindness check.

Not verified: real screen-reader or keyboard testing, real users with
colour-vision deficiency. The chart crosshair and legend are mouse-only and the
SVG has only a one-line label with no data table or keyboard path; the real
chart component needs one. Full WCAG conformance needs manual testing with
assistive technologies and expert review.

## Open decisions

- Light theme: not in v1; variables are structured so it can be added later.
- Red-up/green-down user setting: undecided.
- `--danger` is close to `--down` in hue (worst-case dE 3.7). Icon and label
  cover it today; moving `--danger` toward magenta would help if confusion shows up.
- Chart palette near-matches with `--ai`, `--accent`, `--unch`, `--warn`,
  `--info` (see Chart series). Accept with labels, or adjust the semantic side.
- Candlestick variant with filled/hollow bodies for the bar chart.
- Whether to record the Tailwind v4 + shadcn + token approach as a short ADR.
- Keyboard and screen-reader access for charts (crosshair, data table).

## Preview

An interactive HTML preview of these tokens (surfaces, text, market colours,
status, provenance, type scale, density examples, both charts, live contrast
table) is at [`docs/tokens-preview.html`](docs/tokens-preview.html). It is a
standalone file with hardcoded values, so it can drift from `src/styles.css`.
The `/_tokens` dev route planned for implementation is its intended
replacement; delete the preview once that exists.
