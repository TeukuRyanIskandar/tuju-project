import { createFileRoute } from '@tanstack/react-router'
import { StockDetail } from '#/components/stocks/stock-detail'

export const Route = createFileRoute('/stocks/$code')({
  component: StockPage,
})

function StockPage() {
  const { code } = Route.useParams()
  return <StockDetail key={code} code={code} />
}
