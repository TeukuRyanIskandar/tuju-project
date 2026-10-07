# App shell, search and route placeholders

Type: task
Status: ready-for-agent
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
