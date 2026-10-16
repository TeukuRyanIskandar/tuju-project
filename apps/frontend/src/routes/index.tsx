import { createFileRoute } from '@tanstack/react-router'
import { MarketOverview } from '#/components/market/market-overview'

export const Route = createFileRoute('/')({
  component: MarketOverview,
})
