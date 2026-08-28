import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { LeagueDef } from '../../data/sports/leagues'
import { BROWSE_SCOPE_LABELS, type BrowseScope } from './browseCompetitions'
import { findInChain, isRowEdge, verticalNeighbour, type FocusChain } from './focusChain'
import { leagueFocusKey, scopeFocusKey } from './leagueFocusKeys'
import { LeagueCard } from './LeagueCard'
import { ChevronLeftIcon, ChevronRightIcon } from './sportIcons'
import './CompetitionBrowser.css'

// "Browse more competitions": a full-width, PAGINATED grid inside a
// fixed-height panel.
//
//     ┌ Browse more competitions  [Domestic][International]      1 / 2 ┐
//     │ [◆ Championship  ] [◆ FA Cup      ] … six across               │
//     │ [◆ Eredivisie    ] [◆ Pro League  ]                            │
//     │ [◆ Allsvenskan   ] [◆ Superettan  ]                            │
//     └────────────────────────────────────────────────────────────────┘
//
// WHAT THIS REPLACED. The previous pass made this a master/detail panel: a
// scrolling rail of ~19 countries on the left, that country's competitions
// on the right. That fixed the original disaster (42 cards and 19 headings
// turning one 1080px screen into several screens of document) but made
// country the primary navigation level, which it should never have been —
// 13 of the 21 countries in the real catalogue track exactly ONE
// competition, so most of the rail was a two-step detour to a single card
// floating in an otherwise empty 1380px pane.
//
// Now the competition itself is the primary object: one flat list per
// scope, six across, three rows, paged. Each card carries its own region,
// so nothing is lost by dropping the country heading — see LeagueCard's
// 'compact' variant. The panel still never scrolls, the page still never
// scrolls, and the grid still never mounts more than one page's worth of
// focusables. See browseCompetitions.ts for the model and where 6x3 came
// from.
//
// NOTE ON OWNERSHIP: this component holds NO state. Scope, page, the
// current page's competitions and the grid's focus chain all come from
// OnboardingSportsScreen, which is the single owner of "where does focus go
// when the panel's contents change" — see the rescue effect there for why
// that cannot be split across two components.

interface Props {
  // Which scope tabs to render, left to right. Never empty — the screen
  // does not render this panel at all when there is nothing to browse.
  scopes: readonly BrowseScope[]
  // The scope being browsed; always one of `scopes`.
  scope: BrowseScope
  // Zero-based, already clamped into range by the caller.
  page: number
  pageCount: number
  // ONLY the current page's competitions, in order.
  competitions: readonly LeagueDef[]
  // `competitions` as focus keys, chunked into the grid's rows. Passed in
  // rather than derived here so the screen's focus rescue and this
  // component's arrow handlers can never disagree about the geometry.
  gridChain: FocusChain
  selectedLeagues: ReadonlySet<string>
  // Focusing a tab browses that scope — no OK press needed just to look,
  // same rule the old region rail used.
  onScopeChange: (scope: BrowseScope) => void
  onToggleLeague: (id: string) => void
  // Called only when the requested page exists; the caller both moves the
  // page and decides where focus lands once it has rendered.
  onPageTurn: (page: number, entry: PageEntry) => void
  // The last recommendation row — where Up out of a scope tab goes.
  exitUpFocusKey: string
  // The footer's primary action, so the viewer never has to walk the whole
  // grid to reach Continue.
  exitDownFocusKey: string
  // Records where the viewer left the panel, so Up out of the footer comes
  // back to the same card. Called with the key being left, before focus
  // moves.
  onExitDown: (fromKey: string) => void
}

// Where focus should land on a page that has not rendered yet, expressed in
// GEOMETRY rather than as a focus key — the key does not exist at the
// moment the arrow is pressed. `row` is clamped against the new page, so a
// short final row cannot strand focus.
export interface PageEntry {
  row: number
  column: 'first' | 'last'
}

export function CompetitionBrowser({
  scopes,
  scope,
  page,
  pageCount,
  competitions,
  gridChain,
  selectedLeagues,
  onScopeChange,
  onToggleLeague,
  onPageTurn,
  exitUpFocusKey,
  exitDownFocusKey,
  onExitDown,
}: Props) {
  const activeScopeKey = scopeFocusKey(scope)
  const firstCardKey = gridChain[0]?.[0] ?? null

  // PAGE TURNS ARE HORIZONTAL OVERFLOW, not a separate control. Walking off
  // the right edge of any row moves to the next page and enters it at the
  // left edge of the SAME row; walking off the left edge does the mirror.
  // Keeping the row means a viewer scanning along row 2 stays on row 2
  // across the page break instead of being thrown back to the top-left.
  //
  // At the first/last page the handler is still installed and simply does
  // nothing, which CONSUMES the press: letting norigin's directional search
  // run off the panel hands focus to the screen's invisible root, which
  // draws no focus ring at all.
  // `fromKey` is null for the chevrons, which are not part of the grid and
  // therefore have no row to keep — they enter the new page at its top.
  const turnPage = (delta: -1 | 1, fromKey: string | null) => {
    const next = page + delta
    if (next < 0 || next >= pageCount) return
    const row = fromKey ? findInChain(gridChain, fromKey)?.row ?? 0 : 0
    onPageTurn(next, { row, column: delta === 1 ? 'first' : 'last' })
  }

  return (
    <section className="competition-browser">
      <header className="competition-browser-header">
        <h3 className="competition-browser-title">Browse more competitions</h3>

        <div className="competition-browser-scopes">
          {scopes.map((tab, index) => (
            <ScopeTab
              key={tab}
              scope={tab}
              active={tab === scope}
              previousScope={scopes[index - 1] ?? null}
              nextScope={scopes[index + 1] ?? null}
              // Down enters the grid this tab is actually showing — never a
              // hardcoded id, and never an inactive tab's grid, which is
              // not mounted.
              firstCardKey={tab === scope ? firstCardKey : null}
              exitUpFocusKey={exitUpFocusKey}
              onActivate={onScopeChange}
            />
          ))}
        </div>

        {/* Only worth saying when there is more than one page. The chevrons
            are a mouse affordance and a hint that another page exists —
            they are NOT focusable, so the remote never has to visit them:
            the D-pad turns pages by walking off the grid's edge. */}
        {pageCount > 1 && (
          <div className="competition-browser-pager">
            <span
              className={`competition-browser-page-arrow ${page > 0 ? '' : 'disabled'}`}
              onClick={() => turnPage(-1, null)}
            >
              <ChevronLeftIcon />
            </span>
            <span className="competition-browser-page-count">
              {page + 1} / {pageCount}
            </span>
            <span
              className={`competition-browser-page-arrow ${page + 1 < pageCount ? '' : 'disabled'}`}
              onClick={() => turnPage(1, null)}
            >
              <ChevronRightIcon />
            </span>
          </div>
        )}
      </header>

      <div className="competition-browser-grid">
        {competitions.map((league) => {
          const key = leagueFocusKey(league.id)
          return (
            <LeagueCard
              key={league.id}
              league={league}
              variant="compact"
              selected={selectedLeagues.has(league.id)}
              onToggle={() => onToggleLeague(league.id)}
              arrows={{
                // Up out of the top row returns to the tab that owns this
                // grid, which is the control the viewer came down through.
                onArrowUp: () => {
                  void setFocus(verticalNeighbour(gridChain, key, 'up') ?? activeScopeKey)
                },
                onArrowDown: () => {
                  const target = verticalNeighbour(gridChain, key, 'down')
                  if (target) void setFocus(target)
                  else {
                    onExitDown(key)
                    void setFocus(exitDownFocusKey)
                  }
                },
                onArrowLeft: isRowEdge(gridChain, key, 'left') ? () => turnPage(-1, key) : undefined,
                onArrowRight: isRowEdge(gridChain, key, 'right') ? () => turnPage(1, key) : undefined,
              }}
            />
          )
        })}
      </div>
    </section>
  )
}

// A segmented-control tab, deliberately NOT a card: this is how you switch
// which catalogue you are looking at, not something you select. Selection
// lives entirely in the grid below.
function ScopeTab({
  scope,
  active,
  previousScope,
  nextScope,
  firstCardKey,
  exitUpFocusKey,
  onActivate,
}: {
  scope: BrowseScope
  active: boolean
  previousScope: BrowseScope | null
  nextScope: BrowseScope | null
  firstCardKey: string | null
  exitUpFocusKey: string
  onActivate: (scope: BrowseScope) => void
}) {
  const focusKey = scopeFocusKey(scope)
  const enterGrid = () => {
    if (firstCardKey) void setFocus(firstCardKey)
  }

  const { ref, focused } = useFocusable({
    focusKey,
    // FOCUS IS THE ONLY THING THAT SWITCHES SCOPE. Moving between the tabs
    // swaps the grid immediately — no OK press to "load" a scope, which is
    // what makes this feel like a TV picker rather than a menu of links.
    // Nothing is persisted by focusing; only the cards below toggle a
    // preference. Re-focusing the tab you are already on is a no-op in the
    // screen's reducer, so stepping Up out of the grid and back Down never
    // resets the page you were on.
    onFocus: () => onActivate(scope),
    // OK is a convenience for the same thing Down does, not a requirement.
    onEnterPress: enterGrid,
    onArrowPress: (direction) => {
      if (direction === 'up') {
        void setFocus(exitUpFocusKey)
        return false
      }
      if (direction === 'down') {
        enterGrid()
        return false
      }
      const sibling = direction === 'left' ? previousScope : nextScope
      // No sibling means the end of the tab strip: consume rather than let
      // norigin's search escape sideways out of the panel.
      if (sibling) void setFocus(scopeFocusKey(sibling))
      return false
    },
  })

  return (
    <div
      ref={ref}
      className={`competition-browser-scope ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}
      onClick={() => void setFocus(focusKey)}
    >
      {BROWSE_SCOPE_LABELS[scope]}
    </div>
  )
}
