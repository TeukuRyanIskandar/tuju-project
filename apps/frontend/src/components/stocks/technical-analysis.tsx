import type { StockTechnicalAnalysisArtifact } from '@tuju/contracts'
import { analysisDate, factValue } from './analysis-presentation'

export function TechnicalAnalysis({ artifact: a }: { artifact: StockTechnicalAnalysisArtifact }) {
  const facts = [
    ['SMA 20', a.facts.sma.p20], ['SMA 50', a.facts.sma.p50], ['SMA 200', a.facts.sma.p200],
    ['RSI-14', a.facts.rsi.value], ['MACD line', a.facts.macd.line], ['MACD signal', a.facts.macd.signal],
    ['MACD histogram', a.facts.macd.histogram], ['52-week low', a.facts.week52.low], ['52-week high', a.facts.week52.high],
  ] as const
  return <>
    <p>Timeframe: {a.timeframe} · As of {analysisDate(a.asOf)}</p>
    <h3 className="mt-3 font-semibold">Computed facts</h3>
    <dl className="grid grid-cols-2 gap-2">{facts.map(([label, value]) => <div key={label} className="min-w-0 border-b border-border py-1"><dt className="text-fg-3">{label}</dt><dd className="num break-words">{factValue(value)}</dd></div>)}</dl>
    <h3 className="mt-3 font-semibold">Structured events</h3>
    {a.events.length === 0 && <p>No structured events available.</p>}
    <ul className="space-y-2">{a.events.map((event, index) => <li key={`${event.id}-${index}`} className="border-b border-border py-2">
      <p>{event.label} · <strong>{event.fired ? 'Fired' : 'Not fired'}</strong></p>
      <p className="text-fg-3">{event.id} · {analysisDate(event.at)}</p>
      <dl>{Object.entries(event.values).map(([key, value]) => <div key={key}><dt className="inline">{key}: </dt><dd className="num inline">{factValue(value)}</dd></div>)}</dl>
    </li>)}</ul>
  </>
}
