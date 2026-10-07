# App shell, search and route placeholders

Type: task
Status: done
Blocked by: 04, 07, 08

## Task

- Header with wordmark, navigation and search.
- Search: debounced typeahead on `/search`, opens with <kbd>/</kbd>, arrow keys
  and Enter, navigates to `/stocks/$code`. ARIA combobox pattern.
- Placeholder routes: `/`, `/stocks/$code`, `/screener`, `/announcements`,
  `/calendar`, `/news`, `/ipo/$prospectusId`.
- Not-found and error pages.

## Done when

Tests cover keyboard navigation, the debounced request, and Enter navigating to
the stock page. Every route renders and the build passes.

## Comments

Implemented in `apps/frontend`:

- `AppShell` (skip link, header with wordmark, primary nav and search, single `<main>`) is the root route component. Root `notFoundComponent` and `errorComponent` use `NotFoundPage` and `ErrorPage`.
- `SearchBox`: ARIA combobox, 250ms debounce, limit 8. `/` focuses it outside text fields. Arrows wrap, Enter opens the highlighted option or the first result (ignored while results are stale), Escape closes then clears.
- Placeholder routes for all seven paths. `/` no longer runs the `/health` check; `lib/health.ts` is now unused.
- Tests use `@testing-library/user-event` (added, pinned) with a real router on memory history (`src/test/render-app.tsx`). Debounce is tested on real timers because Testing Library's async helpers wait on a real `setTimeout`.
- Route test file is `-routes.test.tsx` so the router plugin ignores it.
