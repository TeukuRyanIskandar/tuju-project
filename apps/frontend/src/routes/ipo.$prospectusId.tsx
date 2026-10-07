import { createFileRoute } from '@tanstack/react-router'
import { PagePlaceholder } from '#/components/page-placeholder'

export const Route = createFileRoute('/ipo/$prospectusId')({
  component: IpoPlaceholder,
})

function IpoPlaceholder() {
  const { prospectusId } = Route.useParams()
  return <PagePlaceholder title="Prospectus at a glance" detail={`Prospectus ${prospectusId}`} />
}
