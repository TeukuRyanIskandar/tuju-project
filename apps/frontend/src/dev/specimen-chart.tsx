import { useMemo, useState, type MouseEvent } from 'react'
import { cn } from '#/lib/utils'
import { formatDate, formatNumber } from '#/lib/format'
import { movingAverage, niceTicks, type Bar } from './sample-series'

/**
 * TradingView-style line / OHLC specimen for `/_tokens` (DESIGN.md "Charts").
 * Specimen only: it shows how the chart tokens are meant to be used and is not
 * the product chart component. Hover is mouse-only, as DESIGN.md already notes.
 */

const W = 1100
const H = 410
const L = 8
const R = 62
const T = 10
const PH = 272
const VG = 12
const VH = 70
const PLOT_W = W - L - R
const VB = T + PH + VG + VH

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function volume(v: number): string {
  return v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${(v / 1e3).toFixed(0)}K`
}

const up = (b: Bar) => b.c >= b.o
const tone = (b: Bar) => (up(b) ? 'var(--up)' : 'var(--down)')

export interface SpecimenChartProps {
  data: Bar[]
  kind: 'line' | 'bar'
  /** Accessible name of the chart image. */
  label: string
}

export function SpecimenChart({ data, kind, label }: SpecimenChartProps) {
  const n = data.length
  const step = PLOT_W / n
  const x = (i: number) => L + step * (i + 0.5)

  const geo = useMemo(() => {
    const lo = Math.min(...data.map((d) => (kind === 'line' ? d.c : d.l)))
    const hi = Math.max(...data.map((d) => (kind === 'line' ? d.c : d.h)))
    const pad = (hi - lo) * 0.08
    const pmin = lo - pad
    const pmax = hi + pad
    return { pmin, pmax, vmax: Math.max(...data.map((d) => d.v)), ma: movingAverage(data, 20) }
  }, [data, kind])

  const y = (p: number) => T + PH * (1 - (p - geo.pmin) / (geo.pmax - geo.pmin))
  const vy = (v: number) => VB - VH * (v / geo.vmax)

  const [hover, setHover] = useState<{ i: number; cy: number } | null>(null)
  const active = hover?.i ?? n - 1
  const bar = data[active]
  const prev = data[active - 1] ?? bar
  const change = bar.c - prev.c
  const changePct = (change / prev.c) * 100
  const lastTone = kind === 'line' ? 'var(--chart-1)' : tone(data[n - 1])
  const last = data[n - 1]

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - box.left) * W) / box.width
    const my = ((e.clientY - box.top) * H) / box.height
    if (mx < L || mx > W - R || my < T || my > VB) {
      setHover(null)
      return
    }
    setHover({
      i: Math.max(0, Math.min(n - 1, Math.floor((mx - L) / step))),
      cy: Math.max(T, Math.min(T + PH, my)),
    })
  }

  const signed = (v: number, d = 2) => formatNumber(v, { decimals: d, signed: true })
  const dir = change >= 0 ? 'text-up' : 'text-down'
  const legendItem = 'inline-flex gap-1'
  const legendKey = 'text-fg-3'

  const ticks = niceTicks(geo.pmin, geo.pmax, 6)
  const tag = 'font-mono text-[11px]'

  return (
    <div>
      {/* The legend text is the readable data; the SVG below is the picture of it. */}
      <div
        data-testid="chart-legend"
        className="num flex min-h-7 flex-wrap gap-x-3.5 gap-y-1 px-3 pt-2 text-xs"
      >
        {kind === 'bar' ? (
          <>
            <span className={legendItem}><b className={cn('font-normal', legendKey)}>O</b><span className={dir}>{bar.o.toFixed(2)}</span></span>
            <span className={legendItem}><b className={cn('font-normal', legendKey)}>H</b><span className={dir}>{bar.h.toFixed(2)}</span></span>
            <span className={legendItem}><b className={cn('font-normal', legendKey)}>L</b><span className={dir}>{bar.l.toFixed(2)}</span></span>
          </>
        ) : null}
        <span className={legendItem}><b className={cn('font-normal', legendKey)}>C</b><span className={dir}>{bar.c.toFixed(2)}</span></span>
        <span className={dir}>
          {signed(change)} ({signed(changePct)}%)
        </span>
        {kind === 'line' ? (
          <span className={cn(legendItem, 'text-chart-2')}>
            <b className="font-normal">MA 20</b>
            {geo.ma[active] == null ? '—' : geo.ma[active]!.toFixed(2)}
          </span>
        ) : null}
        <span className={legendItem}><b className={cn('font-normal', legendKey)}>Vol</b>{volume(bar.v)}</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* price gridlines + axis labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeOpacity={0.7} />
            <text x={W - R + 8} y={y(t) + 4} className={cn(tag, 'fill-fg-3')}>{t.toFixed(2)}</text>
          </g>
        ))}
        {/* date gridlines */}
        {Array.from({ length: Math.floor((n - 10) / 15) + 1 }, (_, k) => 10 + k * 15)
          .filter((i) => i < n)
          .map((i) => {
            const d = data[i].date
            return (
              <g key={i}>
                <line x1={x(i)} x2={x(i)} y1={T} y2={VB} stroke="var(--border)" strokeOpacity={0.45} />
                <text x={x(i)} y={H - 7} textAnchor="middle" className={cn(tag, 'fill-fg-3')}>
                  {d.getUTCDate()} {MONTHS[d.getUTCMonth()]}
                </text>
              </g>
            )
          })}
        <line x1={L} x2={W - R} y1={VB} y2={VB} stroke="var(--border-strong)" />
        <line x1={W - R} x2={W - R} y1={T} y2={VB} stroke="var(--border)" />

        {/* volume pane: up/down tint at 45% */}
        {data.map((d, i) => (
          <rect
            key={i}
            x={x(i) - step * 0.36}
            y={vy(d.v)}
            width={step * 0.72}
            height={VB - vy(d.v)}
            fill={tone(d)}
            fillOpacity={0.45}
          />
        ))}

        {kind === 'line' ? (
          <>
            <defs>
              <linearGradient id="specimen-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--chart-1)" stopOpacity={0.3} />
                <stop offset="1" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path
              d={`M${data.map((d, i) => `${x(i).toFixed(1)},${y(d.c).toFixed(1)}`).join(' L')} L${x(n - 1)},${T + PH} L${x(0)},${T + PH} Z`}
              fill="url(#specimen-area)"
            />
            <polyline
              fill="none"
              stroke="var(--chart-2)"
              strokeWidth={1.25}
              points={geo.ma
                .map((m, i) => (m == null ? '' : `${x(i).toFixed(1)},${y(m).toFixed(1)}`))
                .filter(Boolean)
                .join(' ')}
            />
            <polyline
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              points={data.map((d, i) => `${x(i).toFixed(1)},${y(d.c).toFixed(1)}`).join(' ')}
            />
          </>
        ) : (
          data.map((d, i) => {
            const tick = Math.max(2.5, step * 0.38)
            return (
              <g key={i} stroke={tone(d)} strokeWidth={1.5}>
                <line x1={x(i)} x2={x(i)} y1={y(d.h)} y2={y(d.l)} />
                <line x1={x(i) - tick} x2={x(i)} y1={y(d.o)} y2={y(d.o)} />
                <line x1={x(i)} x2={x(i) + tick} y1={y(d.c)} y2={y(d.c)} />
              </g>
            )
          })
        )}

        {/* last-price line + axis tag */}
        <line x1={L} x2={W - R} y1={y(last.c)} y2={y(last.c)} stroke={lastTone} strokeDasharray="3 3" strokeOpacity={0.8} />
        <rect x={W - R} y={y(last.c) - 10} width={R - 2} height={20} rx={2} fill={lastTone} />
        <text x={W - R + 7} y={y(last.c) + 4} className={cn(tag, 'fill-surface-0 font-semibold')}>
          {last.c.toFixed(2)}
        </text>

        {/* crosshair */}
        {hover ? (
          <g pointerEvents="none">
            <line x1={x(hover.i)} x2={x(hover.i)} y1={T} y2={VB} stroke="var(--fg-3)" strokeDasharray="4 4" />
            <line x1={L} x2={W - R} y1={hover.cy} y2={hover.cy} stroke="var(--fg-3)" strokeDasharray="4 4" />
            <rect x={W - R} y={hover.cy - 10} width={R - 2} height={20} rx={2} fill="var(--surface-3)" stroke="var(--border-strong)" />
            <text x={W - R + 7} y={hover.cy + 4} className={cn(tag, 'fill-fg')}>
              {(geo.pmin + (1 - (hover.cy - T) / PH) * (geo.pmax - geo.pmin)).toFixed(2)}
            </text>
            <rect
              x={Math.max(L, Math.min(W - R - 78, x(hover.i) - 39))}
              y={VB + 2}
              width={78}
              height={18}
              rx={2}
              fill="var(--surface-3)"
              stroke="var(--border-strong)"
            />
            <text
              x={Math.max(L + 39, Math.min(W - R - 39, x(hover.i)))}
              y={VB + 15}
              textAnchor="middle"
              className={cn(tag, 'fill-fg')}
            >
              {formatDate(bar.date)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  )
}
