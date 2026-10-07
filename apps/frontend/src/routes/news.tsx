import { createFileRoute } from '@tanstack/react-router'
import { PagePlaceholder } from '#/components/page-placeholder'

export const Route = createFileRoute('/news')({
  component: () => <PagePlaceholder title="News" />,
})
