import { createFileRoute } from '@tanstack/react-router'
import { PagePlaceholder } from '#/components/page-placeholder'

export const Route = createFileRoute('/announcements')({
  component: () => <PagePlaceholder title="Announcements" />,
})
