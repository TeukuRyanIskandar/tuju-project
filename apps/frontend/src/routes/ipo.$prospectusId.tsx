import { createFileRoute } from '@tanstack/react-router'
import { ProspectusReader } from '#/components/ipo/prospectus-reader'

export const Route = createFileRoute('/ipo/$prospectusId')({
  component: IpoPage,
})

function IpoPage() {
  const { prospectusId } = Route.useParams()
  return <ProspectusReader key={prospectusId} prospectusId={prospectusId} />
}
