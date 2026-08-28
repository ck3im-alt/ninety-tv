import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, useFocusable, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import type { SportKey } from '../../data/sports/types'
import type { LeagueDef } from '../../data/sports/leagues'
import { useFootballCompetitions } from '../../data/sports/useFootballCompetitions'
import { buildRecommendedLeagues } from './recommendedLeagues'
import {
  BROWSE_GRID_COLUMNS,
  availableScopes,
  browsePage,
  browsePageCount,
  buildBrowseCatalogue,
  clampBrowsePage,
  competitionsIn,
  resolveScope,
  type BrowseScope,
} from './browseCompetitions'
import { chunkIntoRows, isRowEdge, lastRowEntry, verticalNeighbour, type FocusChain } from './focusChain'
import { CompetitionBrowser, type PageEntry } from './CompetitionBrowser'
import { LeagueCard } from './LeagueCard'
import { LEAGUE_FOCUS_PREFIX, SCOPE_FOCUS_PREFIX, leagueFocusKey, scopeFocusKey } from './leagueFocusKeys'
import { OnboardingTopBar } from './OnboardingStepper'
import { useOnboardingLanding } from './useOnboardingLanding'
import { BLOCK_ARROW, SelectableCard } from './SelectableCard'
import { ONBOARDING_PRIMARY_FOCUS_KEY, OnboardingFooter } from './OnboardingActions'
import { FootballIcon, FormulaOneIcon } from './sportIcons'
import './onboardingShared.css'
import './OnboardingSportsScreen.css'

interface PopularSport {
  id: SportKey
  label: string
  icon: () => React.JSX.Element
}

const POPULAR_SPORTS: PopularSport[] = [
  { id: 'football', label: 'Football', icon: FootballIcon },
  { id: 'f1', label: 'Formula 1', icon: FormulaOneIcon },
]

const FOOTBALL_FOCUS_KEY = 'sport-football'
// Matches .league-grid's own `repeat(8, 1fr)` (OnboardingSportsScreen.css).
// Eight is exactly the recommendation's maximum size (Big Five + the two
// tracked UEFA competitions + the viewer's home league), so the pinned row
// is ONE row -- see the row model in focusChain.ts.
const RECOMMENDED_GRID_COLUMNS = 8

const sportKey = (id: SportKey) => `sport-${id}`

// norigin types getCurrentFocusKey() as `string`, but it genuinely returns
// null until something has been focused for the FIRST time -- which is
// exactly when the focus-rescue effects below first run (they fire on
// mount, before any forceFocus has been applied). Reading it through here
// means those effects ask "is focus on something I just removed?" and get a
// plain no, rather than throwing on null.startsWith.
const currentFocusKey = (): string => (getCurrentFocusKey() as string | null) ?? ''

// Which slice of the browsable catalogue the panel is showing. Scope and
// page are ONE piece of state rather than two because the rule that binds
// them -- switching scope starts again at page 0, re-activating the scope
// you are already on does NOT -- is only expressible if both are decided in
// the same update. (Focusing a tab activates its scope, and the viewer
// focuses the active tab every time they step Up out of the grid; two
// independent useStates reset their page on every one of those presses.)
interface BrowseState {
  scope: BrowseScope | null
  page: number
}

interface Props {
  selectedSports: Set<SportKey>
  selectedLeagues: Set<string>
  // Canonical ISO2-ish code for the TV's own country, or null when nothing
  // could be detected -- see data/viewerCountry.ts. Adds the viewer's top
  // domestic league to the recommendations, and floats whatever else Ninety
  // tracks in their own country to the front of the browser's Domestic
  // list; detection failing just means one fewer card and a catalogue
  // ordered by tier alone.
  viewerCountryCode: string | null
  onToggleSport: (id: SportKey) => void
  onToggleLeague: (id: string) => void
  onBack: () => void
  onContinue: () => void
}

// ONBOARDING STEP 2 — SPORTS & LEAGUES.
//
// Three fixed things, no expander, no nesting, no page scroll: the sports
// row, the pinned recommendations, and the whole remaining catalogue as an
// always-open browser panel that takes exactly the leftover height.
//
// THE 2026-08-28 PASS replaced that panel's insides. It used to be a
// master/detail browser — a scrolling rail of ~19 countries, one country's
// competitions at a time — which kept the page one screen tall but made
// COUNTRY the primary navigation level. That is the wrong level: 13 of the
// 21 countries in the real catalogue track exactly one competition, so
// picking Argentina cost find country → enter country → pick its only
// league → walk back out, and left a mostly-empty detail pane. The rail is
// gone; the competition is now the primary selectable object, in a
// full-width paginated grid under two scopes (Domestic / International).
// See CompetitionBrowser.tsx and browseCompetitions.ts.
//
// Teams live on a step of their own — see OnboardingTeamsScreen.
export function OnboardingSportsScreen({
  selectedSports,
  selectedLeagues,
  viewerCountryCode,
  onToggleSport,
  onToggleLeague,
  onBack,
  onContinue,
}: Props) {
  // preferredChildFocusKey as well as the Football card's own forceFocus:
  // forceFocus only applies on mount, but the flow re-focuses this screen's
  // root key on every step change -- including arriving back here from a
  // later step. See OnboardingFlow's STEP_FOCUS_KEYS.
  const { ref, focusKey } = useFocusable({
    focusKey: 'onboarding-sports',
    trackChildren: true,
    preferredChildFocusKey: FOOTBALL_FOCUS_KEY,
  })
  // Back from the Teams step leaves focus on the shared footer Back key,
  // which this step re-registers under the same name — see
  // useOnboardingLanding. The Football card is mounted from the first
  // render, so this only ever has to handle that case.
  useOnboardingLanding(FOOTBALL_FOCUS_KEY)

  const footballSelected = selectedSports.has('football')
  // Competition catalog is an async fetch (GET /v1/competitions) -- see
  // competitionsCatalog.ts -- never a local copy of the 50-competition list.
  const competitionsState = useFootballCompetitions()
  const catalog = useMemo<LeagueDef[]>(
    () => (competitionsState.status === 'ready' ? competitionsState.leagues : []),
    [competitionsState],
  )

  // PINNED, AND ALWAYS THE TOP OF THE SCREEN. Big Five + tracked UEFA
  // competitions + the viewer's own top domestic league (see
  // recommendedLeagues.ts), sized to sit on ONE row. The browser below
  // never scrolls these away and never contains them.
  const recommended = useMemo(() => buildRecommendedLeagues(catalog, viewerCountryCode), [catalog, viewerCountryCode])

  // The rest of the catalog as two flat, deterministically ordered lists,
  // with every recommended id removed so no competition renders twice
  // (which would also mean two focusables fighting over one `league-<id>`
  // key) and duplicate ids dropped.
  const catalogue = useMemo(
    () =>
      buildBrowseCatalogue({
        leagues: catalog,
        recommendedLeagueIds: recommended.map((l) => l.id),
        viewerCountryCode,
      }),
    [catalog, recommended, viewerCountryCode],
  )

  const [browseState, setBrowseState] = useState<BrowseState>({ scope: null, page: 0 })

  // Only scopes that still have something in them get a tab -- the same
  // rule the old rail used for a region whose every competition was
  // recommended.
  const scopes = useMemo(() => availableScopes(catalogue), [catalogue])
  // Null until the user moves; resolveScope answers with Domestic from the
  // very first render, so this state never has to be seeded by an effect.
  const scope = useMemo(() => resolveScope(catalogue, browseState.scope), [catalogue, browseState.scope])
  const scopeCompetitions = useMemo(
    () => (scope ? competitionsIn(catalogue, scope) : []),
    [catalogue, scope],
  )
  const pageCount = browsePageCount(scopeCompetitions)
  const page = clampBrowsePage(browseState.page, scopeCompetitions)
  // THE ONLY COMPETITIONS THE BROWSER MOUNTS. Everything downstream --
  // the grid's focus chain, the mounted-key set, the rescue effect --
  // derives from this one slice.
  const pageCompetitions = useMemo(() => browsePage(scopeCompetitions, page), [scopeCompetitions, page])

  const hasLeagueGrid = footballSelected && recommended.length > 0
  // The browser is open whenever there is anything to put in it. There is
  // no viewer-facing toggle — see this component's header.
  const browsing = hasLeagueGrid && scopes.length > 0 && scope != null

  // THE VERTICAL model for the page above the browser: the sports row, the
  // recommendations row(s), and -- when the browser is showing -- one final
  // row standing for the panel itself, entered at its ACTIVE scope tab
  // (never at whichever tab happens to share the column the viewer came
  // down in). Up/Down for every card is answered by looking the current key
  // up in here (focusChain.ts) rather than each card naming a neighbour, so
  // a partial last row or a differently-sized recommendation set needs no
  // special case. The panel's own grid has its own chain, below.
  const chain = useMemo<FocusChain>(() => {
    const rows: string[][] = [POPULAR_SPORTS.map((sport) => sportKey(sport.id))]
    if (hasLeagueGrid) {
      rows.push(...chunkIntoRows(recommended.map((l) => leagueFocusKey(l.id)), RECOMMENDED_GRID_COLUMNS))
      if (browsing && scope) rows.push([scopeFocusKey(scope)])
    }
    return rows
  }, [hasLeagueGrid, recommended, browsing, scope])

  // The browser grid's own row model, owned HERE rather than inside the
  // panel: the page-turn rescue below has to resolve a geometry ("row 1,
  // first column") against the page that just mounted, and it and the
  // panel's arrow handlers must not be able to disagree about the shape of
  // that page.
  const gridChain = useMemo<FocusChain>(
    () => chunkIntoRows(pageCompetitions.map((l) => leagueFocusKey(l.id)), BROWSE_GRID_COLUMNS),
    [pageCompetitions],
  )

  // One set of arrow handlers for every card on the page above the browser,
  // derived from the model above. Down past the last row is the footer; Up
  // past the first row and Left/Right past a row edge are consumed, because
  // letting norigin's search run off the edge hands focus to the screen's
  // own root, which renders no focus ring at all.
  const arrowsFor = useCallback(
    (key: string) => ({
      onArrowUp: () => {
        const target = verticalNeighbour(chain, key, 'up')
        if (target) void setFocus(target)
      },
      onArrowDown: () => {
        void setFocus(verticalNeighbour(chain, key, 'down') ?? ONBOARDING_PRIMARY_FOCUS_KEY)
      },
      onArrowLeft: isRowEdge(chain, key, 'left') ? BLOCK_ARROW : undefined,
      onArrowRight: isRowEdge(chain, key, 'right') ? BLOCK_ARROW : undefined,
    }),
    [chain],
  )

  // Every focus key the browser currently has mounted. Used only to
  // validate the remembered return key below -- a remembered key whose card
  // has since been unmounted (the page turned, the scope changed, the
  // catalog reloaded) must never be a setFocus target.
  const browserFocusKeys = useMemo(() => {
    const keys = new Set<string>()
    if (!browsing) return keys
    for (const tab of scopes) keys.add(scopeFocusKey(tab))
    for (const league of pageCompetitions) keys.add(leagueFocusKey(league.id))
    return keys
  }, [browsing, scopes, pageCompetitions])

  // Where the user stepped DOWN out of the browser into the footer. Up from
  // Continue returns there rather than to a fixed entry point, so leaving to
  // check the footer and coming back does not lose your place. A ref, not
  // state: it is read at key-press time (norigin re-registers the footer's
  // handlers on every render, so the closure below is never stale) and
  // nothing renders differently because of it.
  const browserReturnKeyRef = useRef<string | null>(null)
  const footerUpFocusKey = useCallback(() => {
    const remembered = browserReturnKeyRef.current
    if (remembered && browserFocusKeys.has(remembered)) return remembered
    // Otherwise the last row of the page model: the browser's active scope
    // tab when it is showing, the recommendations when it is not.
    return lastRowEntry(chain) ?? FOOTBALL_FOCUS_KEY
  }, [browserFocusKeys, chain])

  // Focusing a tab browses that scope. Switching scope starts again at page
  // 0 (page 2 of Domestic means nothing in International); re-activating
  // the scope already on screen changes nothing at all, which is what makes
  // stepping Up to the tab and back Down safe on any page.
  const activateScope = useCallback(
    (next: BrowseScope) => {
      setBrowseState((prev) =>
        resolveScope(catalogue, prev.scope) === next ? { ...prev, scope: next } : { scope: next, page: 0 },
      )
    },
    [catalogue],
  )

  // WHERE FOCUS GOES ON THE PAGE THAT HAS NOT RENDERED YET. Turning a page
  // unmounts the card the viewer is standing on and mounts eighteen that
  // did not exist a moment ago, so the target cannot be named at press
  // time -- only its geometry can. Recorded here and resolved by the one
  // rescue effect below, deliberately in the SAME place as the "focus is on
  // something that just disappeared" rule: norigin's setFocus is async, so
  // two components each calling it in their own effect would race, and the
  // parent's rescue would win and drag focus back out of the new page.
  const pageEntryRef = useRef<PageEntry | null>(null)
  const turnPage = useCallback((next: number, entry: PageEntry) => {
    pageEntryRef.current = entry
    setBrowseState((prev) => ({ ...prev, page: next }))
  }, [])

  // Deselecting Football unmounts the whole league section -- grid and
  // browser. Only redirects when focus actually WAS on something that just
  // disappeared; norigin would otherwise fall back to the invisible screen
  // root.
  useEffect(() => {
    if (footballSelected) return
    const current = currentFocusKey()
    if (current.startsWith(LEAGUE_FOCUS_PREFIX) || current.startsWith(SCOPE_FOCUS_PREFIX)) {
      void setFocus(FOOTBALL_FOCUS_KEY)
    }
  }, [footballSelected])

  // THE SINGLE OWNER of "the browser's contents just changed, where should
  // focus be now". Two cases, in priority order:
  //
  //   1. A page turn the viewer asked for: enter the new page at the same
  //      row they left, clamped so a short final row still catches them.
  //   2. Anything else that unmounted the focused card -- a scope switch
  //      driven by a click, the catalog resolving, the viewer's country
  //      arriving late. Hand focus back to the tab that owns the grid,
  //      which is always mounted.
  //
  // Focus is left alone when it is on a recommendation (those live outside
  // the browser and share the same key prefix) or already on this page.
  useEffect(() => {
    if (!browsing || !scope) return
    const entry = pageEntryRef.current
    pageEntryRef.current = null
    if (entry) {
      const row = gridChain[Math.min(entry.row, gridChain.length - 1)] ?? []
      const target = entry.column === 'first' ? row[0] : row[row.length - 1]
      if (target) {
        void setFocus(target)
        return
      }
    }
    const current = currentFocusKey()
    if (!current.startsWith(LEAGUE_FOCUS_PREFIX)) return
    if (recommended.some((l) => leagueFocusKey(l.id) === current)) return
    if (gridChain.some((row) => row.includes(current))) return
    void setFocus(scopeFocusKey(scope))
  }, [browsing, scope, gridChain, recommended])

  // Nothing on this step opens or closes any more, so Back has exactly one
  // meaning: the previous step. Still routed through the existing
  // back-handler stack rather than a second global key listener.
  useBackHandler(() => {
    onBack()
    return true
  })

  return (
    <FocusContext.Provider value={focusKey}>
      {/* `dense`: this step fits the sports row, the recommendations and a
          whole browser panel inside 1080px, so it tightens the shared
          chrome's vertical rhythm. */}
      <main ref={ref} className="onboarding-screen dense">
        <OnboardingTopBar current={2} />

        <div className="onboarding-heading">
          <h1 className="onboarding-headline">
            Choose the leagues you <span className="accent">follow</span>
          </h1>
          {/* ONE LINE at 1920px, on purpose: a second line costs the browser
              panel ~27px of the height budget documented in
              CompetitionBrowser.css. */}
          <p className="onboarding-description">
            Recommended competitions are pinned at the top — browse everything else Ninety tracks below.
          </p>
        </div>

        {/* `browsing` turns the content area from a centred, scrollable
            document into a fixed layout whose last child (the browser) takes
            exactly the leftover height -- see onboardingShared.css. It is
            also what makes this step immune to the layout-jump class of bug:
            with the spacers switched off, nothing below can move anything
            above it. */}
        <div className={`onboarding-body ${browsing ? 'browsing' : ''}`}>
          <section className="onboarding-section sports-section">
            <h2 className="picker-section-title">Sports</h2>
            <div className="sports-grid">
              {POPULAR_SPORTS.map((sport) => {
                const Icon = sport.icon
                return (
                  <SelectableCard
                    key={sport.id}
                    focusKey={sportKey(sport.id)}
                    selected={selectedSports.has(sport.id)}
                    onToggle={() => onToggleSport(sport.id)}
                    forceFocus={sport.id === 'football'}
                    {...arrowsFor(sportKey(sport.id))}
                  >
                    <div className="pick-card-icon">
                      <Icon />
                    </div>
                    <span className="pick-card-label">{sport.label}</span>
                  </SelectableCard>
                )
              })}
            </div>
          </section>

          {footballSelected && competitionsState.status === 'loading' && <p className="picker-status">Loading competitions...</p>}
          {footballSelected && competitionsState.status === 'error' && <p className="picker-status">{competitionsState.message}</p>}

          {hasLeagueGrid && (
            <section className="onboarding-section">
              <div className="picker-section-header">
                <h2 className="picker-section-title">
                  Recommended leagues
                  <span className="picker-section-counter">{recommended.length} shown</span>
                </h2>
              </div>

              <div className="league-grid">
                {recommended.map((league) => (
                  <LeagueCard
                    key={league.id}
                    league={league}
                    selected={selectedLeagues.has(league.id)}
                    onToggle={() => onToggleLeague(league.id)}
                    arrows={arrowsFor(leagueFocusKey(league.id))}
                  />
                ))}
              </div>
            </section>
          )}

          {browsing && scope && (
            <CompetitionBrowser
              scopes={scopes}
              scope={scope}
              page={page}
              pageCount={pageCount}
              competitions={pageCompetitions}
              gridChain={gridChain}
              selectedLeagues={selectedLeagues}
              onScopeChange={activateScope}
              onToggleLeague={onToggleLeague}
              onPageTurn={turnPage}
              // Up out of the scope tabs lands on the last recommendation
              // row rather than on a control that no longer exists.
              exitUpFocusKey={lastRowEntry(chain.slice(0, -1)) ?? FOOTBALL_FOCUS_KEY}
              exitDownFocusKey={ONBOARDING_PRIMARY_FOCUS_KEY}
              onExitDown={(from) => {
                browserReturnKeyRef.current = from
              }}
            />
          )}
        </div>

        <OnboardingFooter
          onBack={onBack}
          primary={{ label: 'Continue', onPress: onContinue }}
          // Up out of the footer returns to exactly where the user left the
          // browser, falling back to the last row of the page model.
          upFocusKey={footerUpFocusKey}
        />
      </main>
    </FocusContext.Provider>
  )
}
