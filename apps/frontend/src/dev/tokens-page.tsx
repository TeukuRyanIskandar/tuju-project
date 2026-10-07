import { useEffect, useState, type ReactNode } from 'react'
import { ChangeChip } from '#/components/change-chip'
import { Kbd } from '#/components/kbd'
import { Panel } from '#/components/panel'
import { ProvenanceBadge, ProvenanceContainer } from '#/components/provenance'
import { EmptyState, ErrorState, LoadingState } from '#/components/states'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSymbol,
} from '#/components/table'
import { formatCompact, formatDate, formatDateTime, formatNumber, formatPe, formatRm, formatVolume } from '#/lib/format'
import { cn } from '#/lib/utils'
import { CONTRAST_PAIRS, UI_MIN, contrastRatio, type TokenReader } from './contrast'
import { syntheticSeries } from './sample-series'
import { SpecimenChart } from './specimen-chart'

/**
 * `/_tokens`: the design-token reference (ticket 10). Dev builds only, see
 * `routes/[_]tokens.tsx`. Everything here renders with the real `styles.css`
 * tokens and the real `src/components`, so it cannot drift the way
 * `docs/tokens-preview.html` can. Values and contrast ratios are read live
 * from the computed styles.
 */

const LINE_DATA = syntheticSeries(11, 13.4, 110, 0.035)
const BAR_DATA = syntheticSeries(29, 9.6, 90, 0.015)

/** Reads a CSS custom property from :root. Null until mounted (no DOM during SSR). */
function useTokenReader(override?: TokenReader): TokenReader | null {
  const [reader, setReader] = useState<TokenReader | null>(override ?? null)
  useEffect(() => {
    if (override) {
      setReader(() => override)
      return
    }
    const css = getComputedStyle(document.documentElement)
    setReader(() => (name: string) => css.getPropertyValue(name).trim())
  }, [override])
  return reader
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="m-0 mb-2.5 border-b border-border pb-2 text-2xs leading-none font-semibold tracking-label text-fg-3 uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <p className="m-0 mt-3.5 mb-1.5 text-2xs font-medium tracking-wider text-fg-3 uppercase">{children}</p>
}

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 mt-2 text-xs text-fg-3">{children}</p>
}

function Swatch({ token, read, ink = 'var(--fg)' }: { token: string; read: TokenReader | null; ink?: string }) {
  return (
    <li className="m-0 list-none overflow-hidden rounded-lg border border-border bg-surface-1">
      <div
        className="flex h-11 items-end border-b border-border px-2 py-1 font-mono text-2xs font-medium"
        style={{ background: `var(${token})`, color: ink }}
      >
        {read ? read(token) : ''}
      </div>
      <div className="px-2 py-1.5 font-mono text-2xs font-medium text-fg">{token}</div>
    </li>
  )
}

function SwatchGrid({
  tokens,
  read,
  cols = 'grid-cols-2 md:grid-cols-4',
}: {
  tokens: { token: string; ink?: string }[]
  read: TokenReader | null
  cols?: string
}) {
  return (
    <ul className={cn('m-0 grid list-none gap-2 p-0', cols)}>
      {tokens.map((t) => (
        <Swatch key={t.token} token={t.token} ink={t.ink} read={read} />
      ))}
    </ul>
  )
}

const BTN =
  'h-[var(--control-h)] cursor-pointer rounded-md border px-3 text-[12.5px] font-medium transition-colors'
const BTN_DEFAULT = cn(BTN, 'border-control-border bg-surface-2 text-fg hover:bg-surface-3')
const BTN_PRIMARY = cn(BTN, 'border-primary bg-primary font-semibold text-primary-foreground hover:brightness-110')
const BTN_GHOST = cn(BTN, 'border-transparent bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg')
const FIELD =
  'h-[var(--control-h)] rounded-md border border-control-border bg-surface-0 px-2 font-mono text-body text-fg placeholder:text-fg-3'

type Status = 'info' | 'warn' | 'danger'
const STATUS: Record<Status, { icon: string; border: string; ink: string }> = {
  info: { icon: 'i', border: 'border-l-info', ink: 'text-info' },
  warn: { icon: '!', border: 'border-l-warn', ink: 'text-warn' },
  danger: { icon: '×', border: 'border-l-danger', ink: 'text-danger' },
}

/** Status banner: 3px coloured left border, icon and bold label (DESIGN.md "Alerts"). */
function StatusBanner({ status, label, children }: { status: Status; label: string; children: ReactNode }) {
  const s = STATUS[status]
  return (
    <div
      className={cn(
        'mb-1.5 flex items-start gap-2.5 rounded-md border border-l-[3px] border-border bg-surface-1 px-2.5 py-2',
        s.border,
      )}
    >
      <span aria-hidden="true" className={cn('w-4 flex-none text-center font-mono text-xs font-bold', s.ink)}>
        {s.icon}
      </span>
      <div>
        <b className="font-semibold">{label}</b> {children}
      </div>
    </div>
  )
}

function StatusBadge({ status, children }: { status: Status; children: ReactNode }) {
  const tone = {
    info: 'border-info/45 text-info',
    warn: 'border-warn/40 text-warn',
    danger: 'border-danger/45 text-danger',
  }[status]
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center gap-1 rounded-sm border px-1.5 text-2xs font-medium tracking-wider whitespace-nowrap uppercase',
        tone,
      )}
    >
      {children}
    </span>
  )
}

const LAYER_LABEL = 'block font-mono text-2xs text-fg-3'

const TIMEFRAMES = ['1W', '1M', '3M', '6M', '1Y'] as const

function Timeframes() {
  const [active, setActive] = useState<(typeof TIMEFRAMES)[number]>('3M')
  return (
    <div className="flex gap-0.5" role="group" aria-label="Timeframe (specimen, does not change the data)">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          aria-pressed={active === tf}
          onClick={() => setActive(tf)}
          className={cn(
            'h-5 cursor-pointer rounded-sm border-0 px-[7px] text-2xs font-medium transition-colors',
            active === tf ? 'bg-accent-soft text-primary' : 'bg-transparent text-fg-2 hover:bg-surface-3 hover:text-fg',
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  )
}

function TickFlash() {
  const [run, setRun] = useState(0)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* keyed so changing `run` restarts the animation */}
      <span key={`up-${run}`} className="num tokens-flash-up px-2 py-0.5">
        1,642.18
      </span>
      <span key={`down-${run}`} className="num tokens-flash-down px-2 py-0.5">
        1,641.97
      </span>
      <button type="button" className={BTN_DEFAULT} onClick={() => setRun((r) => r + 1)}>
        Replay
      </button>
    </div>
  )
}

function ContrastTable({ read }: { read: TokenReader | null }) {
  const rows = CONTRAST_PAIRS.map(([fg, bg, min]) => {
    const ratio = read ? contrastRatio(fg, bg, read) : null
    return { fg, bg, min, ratio }
  })
  const failures = rows.filter((r) => r.ratio !== null && r.ratio < r.min).length
  const unresolved = rows.filter((r) => r.ratio === null).length
  return (
    <Panel
      title="Contrast (WCAG)"
      headingLevel={3}
      flush
      meta={
        read ? (
          <span data-testid="contrast-summary">
            {failures === 0 && unresolved === 0 ? 'All pass' : `${failures} fail, ${unresolved} unresolved`}
          </span>
        ) : null
      }
    >
      <Table aria-label="Contrast ratios for token pairs">
        <TableCaption>
          Computed live from styles.css. Tinted fills are blended onto their parent surface before measuring.
        </TableCaption>
        <TableHeader>
          <tr>
            <TableHead>Foreground</TableHead>
            <TableHead>Background</TableHead>
            <TableHead numeric>Ratio</TableHead>
            <TableHead numeric>Needs</TableHead>
            <TableHead>Result</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {rows.map(({ fg, bg, min, ratio }) => {
            const ok = ratio !== null && ratio >= min
            return (
              <TableRow key={`${fg}|${bg}`}>
                <TableCell className="font-mono text-xs">{fg}</TableCell>
                <TableCell className="font-mono text-xs">{bg}</TableCell>
                <TableCell numeric>{ratio === null ? '—' : `${ratio.toFixed(2)}:1`}</TableCell>
                <TableCell numeric>
                  {min}:1{min === UI_MIN ? ' (UI)' : ''}
                </TableCell>
                {/* Text label, not colour alone */}
                <TableCell className={cn('font-semibold', ratio === null ? 'text-fg-3' : ok ? 'text-up' : 'text-down')}>
                  {ratio === null ? 'Unknown' : ok ? 'Pass' : 'FAIL'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Panel>
  )
}

const MOVERS = [
  { code: 'MAYBANK', name: 'Malayan Banking', last: 10.42, chg: 0.18, pct: 1.76, vol: 12480300 },
  { code: 'TENAGA', name: 'Tenaga Nasional', last: 14.88, chg: 0.22, pct: 1.5, vol: 8102900, selected: true },
  { code: 'PCHEM', name: 'Petronas Chemicals', last: 4.63, chg: -0.09, pct: -1.91, vol: 5774100 },
  { code: 'SDPLNT', name: 'Sime Darby Plantation', last: 4.92, chg: -0.06, pct: -1.2, vol: 2310000 },
  { code: 'PBBANK', name: 'Public Bank', last: 4.41, chg: 0, pct: 0, vol: 9640500 },
] as const

const INDICES = [
  { label: 'FBM KLCI', value: 1642.18, pct: 0.42 },
  { label: 'FBM 100', value: 11904.55, pct: 0.31 },
  { label: 'FBM ACE', value: 4718.02, pct: -0.66 },
] as const

const chgTone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-unch')

export interface TokensPageProps {
  /** Test seam: supply token values instead of reading computed styles. */
  readToken?: TokenReader
}

export function TokensPage({ readToken }: TokensPageProps = {}) {
  const read = useTokenReader(readToken)

  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-5 pb-16">
      {/* Keyframes only: colours come from the real tick-flash tokens. The reduced-motion guard in styles.css covers them. */}
      <style>{`
        @keyframes tokens-flash-up { from { background: var(--tick-flash-up); } to { background: transparent; } }
        @keyframes tokens-flash-down { from { background: var(--tick-flash-down); } to { background: transparent; } }
        .tokens-flash-up { color: var(--up); animation: tokens-flash-up 600ms ease-out; }
        .tokens-flash-down { color: var(--down); animation: tokens-flash-down 600ms ease-out; }
      `}</style>

      <h1 className="m-0 mb-1 text-xl leading-tight font-semibold">Design tokens: Terminal Dark</h1>
      <p className="m-0 max-w-[72ch] text-fg-2">
        Dense, mono-numeric, hairline borders, one blue accent. Market colours (green up, red down) are kept separate
        from status colours so a danger state never reads as a price drop. This page is rendered by the app with the
        real <code className="font-mono text-xs">styles.css</code> tokens and <code className="font-mono text-xs">src/components</code>.
        It exists in dev builds only. Spec: <code className="font-mono text-xs">apps/frontend/DESIGN.md</code>.
      </p>

      <Section title="Surfaces and borders">
        <SwatchGrid
          read={read}
          tokens={[
            { token: '--surface-0' },
            { token: '--surface-1' },
            { token: '--surface-2' },
            { token: '--surface-3' },
            { token: '--border' },
            { token: '--border-strong' },
            { token: '--control-border' },
            { token: '--accent-soft' },
          ]}
        />
        <Label>Example: how the layers stack</Label>
        <div className="rounded-lg border border-border bg-surface-0 p-3">
          <span className={LAYER_LABEL}>surface-0 / app background</span>
          <div className="rounded-md border border-border bg-surface-1 p-2.5">
            <span className={LAYER_LABEL}>surface-1 / panel, 1px --border</span>
            <div className="mt-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
              <span className={LAYER_LABEL}>surface-2 / raised: table header, panel header</span>
              <div className="mt-1.5 rounded-sm bg-surface-3 px-2.5 py-1.5">
                <span className={LAYER_LABEL}>surface-3 / hover or selected row</span>
                Depth comes from lightness steps and hairlines, never shadows.
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Text and accent">
        <SwatchGrid
          read={read}
          tokens={[
            { token: '--fg', ink: '#000' },
            { token: '--fg-2', ink: '#000' },
            { token: '--fg-3', ink: '#000' },
            { token: '--accent', ink: 'var(--accent-fg)' },
          ]}
        />
        <Label>Example: text hierarchy and accent in use</Label>
        <div className="grid gap-2 md:grid-cols-2">
          <Panel title="Tenaga Nasional" headingLevel={3} meta={<span className="font-normal normal-case">TENAGA · MAIN</span>}>
            <p className="m-0 text-base font-semibold">Q3 earnings beat consensus</p>
            <p className="m-0 mt-1 text-fg-2">
              Secondary text: revenue rose on higher tariff pass-through and lower fuel costs.
            </p>
            <p className="m-0 mt-1 text-xs text-fg-3">
              Muted text: filed {formatDate('2026-10-14')} · Announcement 2026-10-14-0183
            </p>
          </Panel>
          <Panel title="Accent usage" headingLevel={3}>
            <ul className="m-0 flex list-none border-b border-border p-0">
              {['Overview', 'Technicals', 'Fundamentals'].map((tab, i) => (
                <li
                  key={tab}
                  aria-current={i === 0 ? 'true' : undefined}
                  className={cn(
                    '-mb-px border-b-2 px-3 py-1.5',
                    i === 0 ? 'border-primary text-fg' : 'border-transparent text-fg-2',
                  )}
                >
                  {tab}
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_PRIMARY}>
                Primary action
              </button>
              <input
                readOnly
                aria-label="Focus ring example"
                defaultValue="focus ring"
                className={cn(FIELD, 'w-[150px] outline-2 outline-offset-1 outline-primary')}
              />
              <span className="border-l-2 border-primary bg-accent-soft px-2.5 py-0.5">selected row</span>
            </div>
            <Note>Accent is reserved for: active tab, focus ring, selection, primary action. Nothing else.</Note>
          </Panel>
        </div>
      </Section>

      <Section title="Market colours">
        <div className="grid gap-2 md:grid-cols-3">
          <Panel title="Up / down / unchanged" headingLevel={3}>
            <div className="flex flex-wrap items-center gap-2">
              <ChangeChip value={1.24} />
              <ChangeChip value={-0.87} />
              <ChangeChip value={0} />
              <ChangeChip value={null} />
            </div>
            <Note>Always a sign and an arrow, plus a screen-reader word, so colour is never the only signal.</Note>
          </Panel>
          <Panel title="Tick flash" headingLevel={3}>
            <TickFlash />
            <Note>600ms fade. Reduced-motion users get no animation (guard in styles.css).</Note>
          </Panel>
          <Panel title="Market tokens" headingLevel={3}>
            <ul className="num m-0 list-none p-0 text-xs leading-[1.8]">
              {[
                ['--up', 'text-up'],
                ['--down', 'text-down'],
                ['--unch', 'text-unch'],
              ].map(([token, cls]) => (
                <li key={token}>
                  {token} <span className={cls}>{read ? read(token) : ''}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </Section>

      <Section title="Status and provenance">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status="info">Info</StatusBadge>
          <StatusBadge status="warn">Delayed 15m</StatusBadge>
          <StatusBadge status="danger">Suspended</StatusBadge>
          <ProvenanceBadge kind="ai" label="AI summary" />
          <ProvenanceBadge kind="synthetic" />
          <ProvenanceBadge kind="demo-only" />
        </div>
        <Note>AI = violet solid. Synthetic and demo data = cyan dashed. Both carry text, never colour alone.</Note>
        <Label>Example: status banners (icon and label, never colour alone)</Label>
        <StatusBanner status="info" label="Info.">
          Index levels recompute nightly after the 17:30 ingest.
        </StatusBanner>
        <StatusBanner status="warn" label="Delayed 15 minutes.">
          Quotes shown are not real-time.
        </StatusBanner>
        <ErrorState title="Trading suspended." message="PCHEM has been suspended pending an announcement." />
        <Label>Example: provenance containers</Label>
        <div className="grid gap-2 md:grid-cols-2">
          <ProvenanceContainer
            kind="ai"
            label="AI summary"
            caption={`Generated ${formatDateTime('2026-10-14T08:05:00Z')} · not investment advice`}
          >
            <p className="m-0">
              The company guided for flat margins next quarter and flagged higher financing costs as the main risk.
            </p>
          </ProvenanceContainer>
          <ProvenanceContainer kind="synthetic" caption="Dashed border marks anything that is not live market data.">
            <p className="m-0">Prices on this page are generated for demonstration and do not reflect real trading.</p>
          </ProvenanceContainer>
        </div>
        <Label>Example: loading and empty states</Label>
        <div className="grid gap-2 md:grid-cols-2">
          <Panel title="Loading" headingLevel={3}>
            <LoadingState label="Loading movers…" />
          </Panel>
          <Panel title="Empty" headingLevel={3}>
            <EmptyState title="No results" description="Try a wider filter." action={<button type="button" className={BTN_DEFAULT}>Reset filters</button>} />
          </Panel>
        </div>
      </Section>

      <Section title="Chart series (Okabe-Ito based, see DESIGN.md)">
        <SwatchGrid
          read={read}
          cols="grid-cols-3 md:grid-cols-6"
          tokens={[1, 2, 3, 4, 5, 6].map((i) => ({ token: `--chart-${i}`, ink: '#000' }))}
        />
        <Label>Example: line chart (hover for crosshair)</Label>
        <Panel
          title="TENAGA"
          headingLevel={3}
          flush
          meta={
            <>
              <span>Tenaga Nasional · 1D · MYX</span>
              <Timeframes />
              <ProvenanceBadge kind="synthetic" label="Synthetic" />
            </>
          }
        >
          <SpecimenChart data={LINE_DATA} kind="line" label="Line chart of closing price with 20-day moving average and volume. Synthetic data." />
        </Panel>
        <Label>Example: OHLC bar chart (tick left = open, tick right = close; colour = close vs open)</Label>
        <Panel
          title="MAYBANK"
          headingLevel={3}
          flush
          meta={
            <>
              <span>Malayan Banking · 1D · MYX</span>
              <ProvenanceBadge kind="synthetic" label="Synthetic" />
            </>
          }
        >
          <SpecimenChart data={BAR_DATA} kind="bar" label="OHLC bar chart with volume. Synthetic data." />
        </Panel>
        <Note>
          Chart hover is mouse-only and the SVG has no data table or keyboard path; the legend above each chart is the
          text form of the hovered bar. The product chart component needs a real one (DESIGN.md, Open decisions).
        </Note>
      </Section>

      <Section title="Type">
        <Panel title="Scale" headingLevel={3}>
          <dl className="m-0">
            {[
              ['20 / UI 600', <span key="a" className="text-xl font-semibold">Bursa Malaysia overview</span>],
              ['16 / UI 600', <span key="b" className="text-base font-semibold">Top movers today</span>],
              ['13 / UI 400 (default)', <span key="c">Announcement summary text sits at the default body size.</span>],
              ['12 / UI 400', <span key="d" className="text-xs text-fg-2">Secondary metadata and table captions.</span>],
              ['11 / UI caps', <span key="e" className="text-2xs font-semibold tracking-label text-fg-3 uppercase">Section label</span>],
              [
                '13 / Mono tabular',
                <span key="f" className="num">
                  {formatNumber(1642.18)} &nbsp; {formatNumber(0.525, { decimals: 4 })} &nbsp; {formatVolume(12480300)} &nbsp;{' '}
                  {formatNumber(-0.87)}%
                </span>,
              ],
              ['15 / Mono 600', <span key="g" className="num text-[15px] font-semibold">MAYBANK 10.42</span>],
            ].map(([key, sample]) => (
              <div key={key as string} className="flex items-baseline gap-4 border-b border-border py-1.5 last:border-b-0">
                <dt className="w-[150px] flex-none font-mono text-2xs text-fg-3">{key}</dt>
                <dd className="m-0">{sample}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Label>Formatters (src/lib/format)</Label>
        <Panel title="Display formatting" headingLevel={3} flush>
          <Table aria-label="Formatter examples">
            <TableHeader>
              <tr>
                <TableHead>Call</TableHead>
                <TableHead numeric>Output</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {[
                ['formatRm(1234.5)', formatRm(1234.5)],
                ['formatRm(1.2e9, { compact: true })', formatRm(1.2e9, { compact: true })],
                ['formatCompact(3.42e9)', formatCompact(3.42e9)],
                ['formatPe(null)', formatPe(null)],
                ['formatPe(14.3)', formatPe(14.3)],
                ['formatDateTime("2026-10-14T08:05:00Z")', formatDateTime('2026-10-14T08:05:00Z')],
                ['formatNumber(undefined)', formatNumber(undefined)],
              ].map(([call, out]) => (
                <TableRow key={call}>
                  <TableCell className="font-mono text-xs">{call}</TableCell>
                  <TableCell numeric>{out}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </Section>

      <Section title="In context: density check">
        <ul className="m-0 mb-2 flex list-none overflow-hidden rounded-lg border border-border bg-surface-1 p-0">
          {INDICES.map((ix) => (
            <li key={ix.label} className="min-w-0 flex-1 border-r border-border px-3 py-1.5">
              <div className="text-2xs font-medium tracking-wider text-fg-3 uppercase">{ix.label}</div>
              <div className="num text-[15px] font-semibold">{formatNumber(ix.value)}</div>
              <ChangeChip value={ix.pct} />
            </li>
          ))}
          <li className="min-w-0 flex-1 border-r border-border px-3 py-1.5">
            <div className="text-2xs font-medium tracking-wider text-fg-3 uppercase">Volume</div>
            <div className="num text-[15px] font-semibold">{formatCompact(3.42e9, 2)}</div>
            <span className="num text-xs text-fg-3">shares traded</span>
          </li>
          <li className="min-w-0 flex-1 px-3 py-1.5">
            <div className="text-2xs font-medium tracking-wider text-fg-3 uppercase">Breadth</div>
            {/* Counts, not price movement: plain text per DESIGN.md, so no change chip and no colour. */}
            <div className="num text-[15px] font-semibold">612 up / 488 down</div>
          </li>
        </ul>

        <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
          <Panel
            title="Top movers"
            headingLevel={3}
            flush
            meta={
              <>
                <ProvenanceBadge kind="synthetic" label="Synthetic" />
                <span>5 of 30 · 26px rows</span>
              </>
            }
          >
            <Table aria-label="Top movers (synthetic)">
              <TableHeader>
                <tr>
                  <TableHead>Symbol</TableHead>
                  <TableHead numeric>Last</TableHead>
                  <TableHead numeric>Chg</TableHead>
                  <TableHead numeric>%</TableHead>
                  <TableHead numeric>Volume</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {MOVERS.map((m) => (
                  <TableRow key={m.code} selected={'selected' in m && m.selected}>
                    <TableCell>
                      <TableSymbol code={m.code} name={m.name} />
                    </TableCell>
                    <TableCell numeric>{formatNumber(m.last, { decimals: 3 })}</TableCell>
                    <TableCell numeric className={chgTone(m.chg)}>
                      {formatNumber(m.chg, { decimals: 3, signed: true })}
                    </TableCell>
                    <TableCell numeric>
                      <ChangeChip value={m.pct} />
                    </TableCell>
                    <TableCell numeric>{formatVolume(m.vol)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          <Panel title="Daily brief" headingLevel={3} meta={<ProvenanceBadge kind="ai" label="AI" />}>
            <p className="m-0 mb-2">
              Banks led the index higher while plantation names gave back early gains. Breadth stayed narrowly positive.
            </p>
            <p className="m-0 text-xs text-fg-3">as of 15:30 MYT</p>
          </Panel>
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_PRIMARY}>Run screener</button>
          <button type="button" className={BTN_DEFAULT}>Export CSV</button>
          <button type="button" className={BTN_GHOST}>Reset</button>
          <input className={cn(FIELD, 'w-[200px]')} placeholder="Min market cap" aria-label="Min market cap" />
          <Kbd>/</Kbd>
          <span className="text-fg-3">
            Press <Kbd>/</Kbd> to search, <Kbd>g</Kbd> <Kbd>s</Kbd> for screener
          </span>
        </div>
      </Section>

      <Section title="Contrast">
        <ContrastTable read={read} />
      </Section>
    </div>
  )
}
