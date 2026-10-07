import { createFileRoute } from '@tanstack/react-router'
import { PagePlaceholder } from '#/components/page-placeholder'

export const Route = createFileRoute('/stocks/$code')({
  component: StockPlaceholder,
})

function StockPlaceholder() {
  const { code } = Route.useParams()
  return <PagePlaceholder title={`Stock ${code}`} />
}
