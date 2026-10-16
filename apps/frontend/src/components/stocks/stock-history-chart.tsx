import { useId, useState } from 'react'
import { EmptyState } from '#/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/table'
import { formatDate, formatRm, formatVolume } from '#/lib/format'
import type { HistoryPoint } from './stock-history'

export function StockHistoryChart({ points }: { points: readonly HistoryPoint[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const helpId = useId()
  const index = Math.max(0, selected === null ? points.length - 1 : points.findIndex(point => point.date === selected))
  const current = points[index]
  const prices = points.flatMap(point => point.close === null ? [] : [point.close])
  const min = prices.length ? Math.min(...prices) : 0
  const max = prices.length ? Math.max(...prices) : 0
  const volumeMax = Math.max(1, ...points.map(point => point.volume ?? 0))
  // Nonnegative values normalized before subtraction/multiplication avoid overflow.
  const y = (value: number) => max === min ? 105 : 180 - ((value / max - min / max) / (1 - min / max)) * 150
  const start = points[0] ? Date.parse(`${points[0].date}T00:00:00Z`) : 0
  const end = points.at(-1) ? Date.parse(`${points.at(-1)!.date}T00:00:00Z`) : start
  const x = (point: HistoryPoint) => end === start ? 270 : 12 + (Date.parse(`${point.date}T00:00:00Z`) - start) / (end - start) * 510
  const valueText = current ? `${formatDate(current.date)}; close ${formatRm(current.close, { decimals: 3 })}; volume ${formatVolume(current.volume)}` : ''
  return <>
    {prices.length ? <svg viewBox="0 0 640 290" role="img" aria-label="Daily EOD close price line and volume bars; exact values in daily data table" className="my-2 block w-full text-chart-1"
      onPointerMove={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        if (!rect.width) return
        const target = (event.clientX - rect.left) / rect.width * 640
        const nearest = points.reduce((a, b) => Math.abs(x(a) - target) < Math.abs(x(b) - target) ? a : b)
        setSelected(nearest.date)
      }}>
      {[30, 105, 180, 255].map(level => <line key={level} x1="12" x2="530" y1={level} y2={level} stroke="var(--border)" />)}
      <text x="538" y="20" fill="var(--fg-3)" fontSize="11">Close (RM)</text>
      <text x="538" y="38" fill="currentColor" fontSize="11">{formatRm(max, { decimals: 3 })}</text>
      <text x="538" y="184" fill="currentColor" fontSize="11">{formatRm(min, { decimals: 3 })}</text>
      <text x="538" y="220" fill="var(--fg-3)" fontSize="11">Volume</text>
      <text x="538" y="236" fill="var(--fg-3)" fontSize="11">(shares)</text>
      {points.map((point, i) => {
        const next = points[i + 1]
        return <g key={point.date}>
          {point.close !== null && <>
            {next?.close != null && <line x1={x(point)} y1={y(point.close)} x2={x(next)} y2={y(next.close)} stroke="currentColor" strokeWidth="2" />}
            <circle cx={x(point)} cy={y(point.close)} r={i === index ? 4 : 2} fill="currentColor" />
          </>}
          {point.volume !== null && <rect x={x(point) - 1.5} y={255 - point.volume / volumeMax * 45} width="3" height={point.volume / volumeMax * 45} fill="var(--chart-6)" />}
        </g>
      })}
      {current && <line x1={x(current)} x2={x(current)} y1="25" y2="257" stroke="var(--fg-2)" strokeDasharray="3 3" />}
      <text x="12" y="280" fill="var(--fg-3)" fontSize="11">{formatDate(points[0]?.date)}</text>
      <text x="530" y="280" textAnchor="end" fill="var(--fg-3)" fontSize="11">{formatDate(points.at(-1)?.date)}</text>
    </svg> : <EmptyState title="No usable close prices in this window" />}
    {current && <div className="my-2 space-y-1">
      <p className="num break-words text-xs" aria-live="polite">{valueText}</p>
      <label className="block text-xs text-fg-2">Inspect trading day
        <input type="range" min="0" max={Math.max(0, points.length - 1)} step="1" value={index} disabled={points.length < 2}
          aria-describedby={helpId} aria-valuetext={valueText} className="block h-7 w-full accent-primary"
          onChange={event => setSelected(points[Number(event.target.value)].date)} />
      </label>
      <p id={helpId} className="text-xs text-fg-3">Use arrow keys, Home or End to inspect dates. Missing values are —, not zero.</p>
    </div>}
    <details>
      <summary className="cursor-pointer text-xs text-fg-2">Inspect daily data table</summary>
      <Table aria-label="Daily EOD dates, close and volume">
        <TableHeader><TableRow><TableHead>Trading date</TableHead><TableHead numeric>Close (RM)</TableHead><TableHead numeric>Volume (shares)</TableHead></TableRow></TableHeader>
        <TableBody>{points.map(point => <TableRow key={point.date}><TableCell>{formatDate(point.date)}</TableCell><TableCell numeric>{formatRm(point.close, { decimals: 3 })}</TableCell><TableCell numeric>{formatVolume(point.volume)}</TableCell></TableRow>)}</TableBody>
      </Table>
    </details>
  </>
}
