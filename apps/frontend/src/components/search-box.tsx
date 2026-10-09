import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { searchQuery } from '#/api/search'
import { Kbd } from '#/components/kbd'
import { useDebouncedValue } from '#/hooks/use-debounced-value'
import { cn } from '#/lib/utils'

export const SEARCH_DEBOUNCE_MS = 250
export const SEARCH_LIMIT = 8

/** True when a keystroke is already going into a text field. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Stock search typeahead (ARIA 1.2 combobox with a listbox popup).
 *
 * Focus stays in the input; the highlighted option is exposed through
 * `aria-activedescendant`. Pressing Enter with nothing highlighted opens the
 * first result.
 */
export function SearchBox() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const debounced = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS)
  const query = useQuery({
    ...searchQuery({ q: debounced, limit: SEARCH_LIMIT }),
    enabled: debounced.length > 0,
    placeholderData: keepPreviousData,
  })

  const hasText = text.trim().length > 0
  const items = hasText ? (query.data?.items ?? []) : []
  // Results are stale until the debounce and the request catch up with the text.
  const stale = hasText && (debounced !== text.trim() || query.isPlaceholderData)
  const pending = stale || (hasText && query.isFetching)
  const showPopup = open && hasText

  // A new result set invalidates the highlight: an index into the previous
  // list would point at a different stock, or past the end of a shorter one.
  useEffect(() => setActiveIndex(-1), [query.data])

  // "/" focuses the search from anywhere outside a text field.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function reset() {
    setText('')
    setOpen(false)
    setActiveIndex(-1)
  }

  function go(code: string) {
    reset()
    inputRef.current?.blur()
    void navigate({ to: '/stocks/$code', params: { code } })
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        if (!hasText) return
        setOpen(true)
        if (items.length === 0) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex((current) => {
          if (current === -1) return step === 1 ? 0 : items.length - 1
          return (current + step + items.length) % items.length
        })
        return
      }
      case 'Enter': {
        const target = items[activeIndex] ?? items[0]
        if (showPopup && !stale && target) {
          event.preventDefault()
          go(target.stockCode)
        }
        return
      }
      case 'Escape': {
        if (showPopup) {
          event.preventDefault()
          setOpen(false)
          setActiveIndex(-1)
        } else if (text) {
          event.preventDefault()
          reset()
        }
        return
      }
    }
  }

  return (
    <div className="relative w-full max-w-sm">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search stocks"
        aria-autocomplete="list"
        aria-expanded={showPopup}
        aria-controls={listboxId}
        aria-activedescendant={showPopup && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search code or company"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
          setActiveIndex(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          setActiveIndex(-1)
        }}
        onKeyDown={onKeyDown}
        className="h-[var(--control-h)] w-full rounded-md border border-control-border bg-surface-1 pr-8 pl-2.5 text-body text-fg placeholder:text-fg-3"
      />
      {!text ? (
        <Kbd aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
          /
        </Kbd>
      ) : null}

      <div
        className={cn(
          'absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-md border border-control-border bg-popover',
          !showPopup && 'hidden',
        )}
      >
        <ul id={listboxId} role="listbox" aria-label="Search results" className="m-0 list-none p-0">
          {items.map((item, index) => (
            <li
              key={item.stockCode}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              // mousedown, not click: the input's blur would close the popup first.
              onMouseDown={(event) => {
                event.preventDefault()
                go(item.stockCode)
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                'flex cursor-pointer items-baseline gap-2 border-l-2 border-transparent px-2.5 py-1.5 text-body',
                index === activeIndex && 'border-primary bg-accent-soft',
              )}
            >
              <span className="num w-12 flex-none text-fg-2">{item.stockCode}</span>
              <span className="min-w-0 flex-1 truncate text-fg">{item.shortName}</span>
              <span className="truncate text-xs text-fg-3">{item.companyName}</span>
              <span className="flex-none text-2xs text-fg-3 uppercase">{item.board}</span>
            </li>
          ))}
        </ul>
        <div role="status" aria-live="polite" className="px-2.5 py-1.5 text-xs text-fg-3">
          {pending
            ? 'Searching…'
            : query.isError
              ? 'Search is unavailable. Try again.'
              : items.length === 0 && hasText
                ? 'No matches'
                : ''}
        </div>
      </div>
    </div>
  )
}
