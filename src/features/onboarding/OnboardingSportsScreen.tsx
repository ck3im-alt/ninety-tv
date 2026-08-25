import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, useFocusable, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import type { SportKey } from '../../data/sports/types'
import type { LeagueDef } from '../../data/sports/leagues'
import { useFootballCompetitions } from '../../data/sports/useFootballCompetitions'
import { buildRecommendedLeagues } from './recommendedLeagues'
import { groupExpandedLeagues } from './groupExpandedLeagues'
import { resolveActiveGroup } from './leagueBrowserState'
import { chunkIntoRows, isRowEdge, lastRowEntry, verticalNeighbour, type FocusChain } from './focusChain'
import { LeagueBrowser } from './LeagueBrowser'
import { LeagueCard } from './LeagueCard'
import { LEAGUE_FOCUS_PREFIX, REGION_FOCUS_PREFIX, leagueFocusKey, regionFocusKey } from './leagueFocusKeys'
import { OnboardingExpander } from './OnboardingExpander'
import { OnboardingTopBar } from './OnboardingStepper'
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
const LEAGUES_TOGGLE_FOCUS_KEY = 'leagues-toggle'
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

interface Props {
  selectedSports: Set<SportKey>
  selectedLeagues: Set<string>
  // Canonical ISO2-ish code for the TV's own country, or null when nothing
  // could be detected -- see data/viewerCountry.ts. Adds the viewer's top
  // domestic league to the recommendations, and makes their own region both
  // the first row of the browser's rail and the region it opens on;
  // detection failing just means one fewer card and a browser that opens on
  // the international competitions instead.
  viewerCountryCode: string | null
  showAllLeagues: boolean
  onToggleShowAllLeagues: () => void
  onToggleSport: (id: SportKey) => void
  onToggleLeague: (id: string) => void
  onBack: () => void
  onContinue: () => void
}

export function OnboardingSportsScreen({
  selectedSports,
  selectedLeagues,
  viewerCountryCode,
  showAllLeagues,
  onToggleShowAllLeagues,
  onToggleSport,
  onToggleLeague,
  onBack,
  onContinue,
}: Props) {
  // preferredChildFocusKey as well as the Football card's own forceFocus:
  // forceFocus only applies on mount, but the flow re-focuses this screen's
  // root key on every step change -- including arriving back here from
  // step 3. See OnboardingFlow's STEP_FOCUS_KEYS.
  const { ref, focusKey } = useFocusable({
    focusKey: 'onboarding-sports',
    trackChildren: true,
    preferredChildFocusKey: FOOTBALL_FOCUS_KEY,
  })
  const footballSelected = selectedSports.has('football')
  // Competition catalog is an async fetch (GET /v1/competitions) -- see
  // competitionsCatalog.ts -- never a local copy of the 50-competition list.
  const competitionsState = useFootballCompetitions()
  const catalog = useMemo<LeagueDef[]>(
    () => (competitionsState.status === 'ready' ? competitionsState.leagues : []),
    [competitionsState],
  )

  // PINNED, AND STILL THE TOP OF THE SCREEN WHEN THE BROWSER IS OPEN.
  // Big Five + tracked UEFA competitions + the viewer's own top domestic
  // league (see recommendedLeagues.ts), sized to sit on ONE row. Opening
  // the browser appends a panel below; it never scrolls these away and
  // never moves them into the browser.
  const recommended = useMemo(() => buildRecommendedLeagues(catalog, viewerCountryCode), [catalog, viewerCountryCode])

  // The rest of the catalog, grouped by region and ordered home-first, with
  // every recommended id removed so no competition renders twice (which
  // would also mean two focusables fighting over one `league-<id>` key) and
  // with no empty group. Unchanged by this pass -- the browser below is a
  // new way of RENDERING this result, not a new way of computing it.
  const groups = useMemo(
    () =>
      groupExpandedLeagues({
        leagues: catalog,
        recommendedLeagueIds: recommended.map((l) => l.id),
        viewerCountryCode,
      }),
    [catalog, recommended, viewerCountryCode],
  )
  const expandedCount = useMemo(() => groups.reduce((total, group) => total + group.leagues.length, 0), [groups])
  const canShowAll = groups.length > 0
  const hasLeagueGrid = footballSelected && recommended.length > 0
  const expanded = showAllLeagues && canShowAll && hasLeagueGrid

  // Which region the browser is showing. Null until the user moves in the
  // rail -- resolveActiveGroup then answers with the default region, so the
  // browser has an active region from the very first render and this state
  // never has to be seeded by an effect.
  const [activeRegionKey, setActiveRegionKey] = useState<string | null>(null)
  const activeGroup = useMemo(() => resolveActiveGroup(groups, activeRegionKey), [groups, activeRegionKey])

  // THE VERTICAL model for the page above the browser: the sports row, the
  // recommendations row(s), the expander, and -- when the browser is open
  // -- one final row standing for the panel itself, entered at its active
  // region. Up/Down for every card is answered by looking the current key
  // up in here (focusChain.ts) rather than each card naming a neighbour, so
  // a partial last row or a differently-sized recommendation set needs no
  // special case. The browser's own two columns have their own chains --
  // see LeagueBrowser.
  const chain = useMemo<FocusChain>(() => {
    const rows: string[][] = [POPULAR_SPORTS.map((sport) => sportKey(sport.id))]
    if (hasLeagueGrid) {
      rows.push(...chunkIntoRows(recommended.map((l) => leagueFocusKey(l.id)), RECOMMENDED_GRID_COLUMNS))
      if (canShowAll) rows.push([LEAGUES_TOGGLE_FOCUS_KEY])
      if (expanded && activeGroup) rows.push([regionFocusKey(activeGroup.key)])
    }
    return rows
  }, [hasLeagueGrid, recommended, canShowAll, expanded, activeGroup])

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

  // Every focus key the open browser currently has mounted. Used only to
  // validate the remembered return key below -- a remembered key whose card
  // has since been unmounted (the region changed, the catalog reloaded)
  // must never be a setFocus target.
  const browserFocusKeys = useMemo(() => {
    const keys = new Set<string>()
    if (!expanded) return keys
    for (const group of groups) keys.add(regionFocusKey(group.key))
    for (const league of activeGroup?.leagues ?? []) keys.add(leagueFocusKey(league.id))
    return keys
  }, [expanded, groups, activeGroup])

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
    // Otherwise the last row of the page model: the browser's active region
    // when it is open, the expander when it is not.
    return lastRowEntry(chain) ?? FOOTBALL_FOCUS_KEY
  }, [browserFocusKeys, chain])

  // Deselecting Football unmounts the whole league section -- grid, expander
  // and browser. Only redirects when focus actually WAS on something that
  // just disappeared; norigin would otherwise fall back to the invisible
  // screen root.
  useEffect(() => {
    if (footballSelected) return
    const current = currentFocusKey()
    const inLeagueSection =
      current.startsWith(LEAGUE_FOCUS_PREFIX) || current.startsWith(REGION_FOCUS_PREFIX) || current === LEAGUES_TOGGLE_FOCUS_KEY
    if (inLeagueSection) void setFocus(FOOTBALL_FOCUS_KEY)
  }, [footballSelected])

  // Closing the browser unmounts every region row and every card in it.
  // Focus is normally already on the expander (that is what was pressed),
  // but no other route into a close may leave focus pointing at a removed
  // element.
  useEffect(() => {
    if (expanded) return
    const current = currentFocusKey()
    const wasInBrowser =
      current.startsWith(REGION_FOCUS_PREFIX) ||
      (current.startsWith(LEAGUE_FOCUS_PREFIX) && !recommended.some((l) => leagueFocusKey(l.id) === current))
    if (wasInBrowser) void setFocus(LEAGUES_TOGGLE_FOCUS_KEY)
  }, [expanded, recommended])

  // Changing region swaps the entire detail pane. Focus normally sits in the
  // rail while that happens (focusing a region row is what changes it), but
  // a mouse/click route can leave it on a card that is no longer rendered --
  // hand it back to the region that now owns the pane.
  useEffect(() => {
    if (!expanded || !activeGroup) return
    const current = currentFocusKey()
    if (!current.startsWith(LEAGUE_FOCUS_PREFIX)) return
    if (recommended.some((l) => leagueFocusKey(l.id) === current)) return
    if (activeGroup.leagues.some((l) => leagueFocusKey(l.id) === current)) return
    void setFocus(regionFocusKey(activeGroup.key))
  }, [expanded, activeGroup, recommended])

  // Back inside the open browser closes it and returns to the control that
  // opened it, rather than leaving step 2 outright -- the standard "unwind
  // the innermost thing first" TV behaviour, through the existing
  // back-handler stack (no second global key listener). Focus is moved
  // BEFORE the state change so nothing is unmounted while focused. A second
  // Back reaches this same handler with nothing left to close and goes back
  // to step 1.
  useBackHandler(() => {
    if (expanded) {
      void setFocus(LEAGUES_TOGGLE_FOCUS_KEY)
      onToggleShowAllLeagues()
      return true
    }
    onBack()
    return true
  })

  return (
    <FocusContext.Provider value={focusKey}>
      {/* `dense`: this step has the most to fit of the three (sports +
          recommendations + a whole browser panel + the footer, all inside
          1080px), so it tightens the shared chrome's vertical rhythm. */}
      <main ref={ref} className="onboarding-screen dense">
        <OnboardingTopBar current={2} />

        <div className="onboarding-heading">
          <h1 className="onboarding-headline">
            Choose what you <span className="accent">follow</span>
          </h1>
          <p className="onboarding-description">
            Pick your favorite leagues so Ninety can personalize your Home screen.
          </p>
        </div>

        {/* `browsing` turns the content area from a centred, scrollable
            document into a fixed layout whose last child (the browser) takes
            exactly the leftover height -- see onboardingShared.css. */}
        <div className={`onboarding-body ${expanded ? 'browsing' : ''}`}>
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

              {/* Stays mounted, in this exact DOM position, under this exact
                  focusKey whether or not the browser below is open -- only
                  the label changes. Pressing OK opens a panel BELOW it and
                  moves nothing, so focus never has to be rescued. */}
              {canShowAll && (
                <OnboardingExpander
                  focusKey={LEAGUES_TOGGLE_FOCUS_KEY}
                  expanded={expanded}
                  moreLabel={`Browse all leagues (${expandedCount})`}
                  fewerLabel="Hide league browser"
                  chain={chain}
                  onToggle={onToggleShowAllLeagues}
                />
              )}
            </section>
          )}

          {expanded && activeGroup && (
            <LeagueBrowser
              groups={groups}
              activeGroup={activeGroup}
              selectedLeagues={selectedLeagues}
              onActivateRegion={setActiveRegionKey}
              onToggleLeague={onToggleLeague}
              exitUpFocusKey={LEAGUES_TOGGLE_FOCUS_KEY}
              exitDownFocusKey={ONBOARDING_PRIMARY_FOCUS_KEY}
              onExitDown={(from) => {
                browserReturnKeyRef.current = from
              }}
            />
          )}
        </div>

        <OnboardingFooter onBack={onBack} primary={{ label: 'Continue', onPress: onContinue }} upFocusKey={footerUpFocusKey} />
      </main>
    </FocusContext.Provider>
  )
}
