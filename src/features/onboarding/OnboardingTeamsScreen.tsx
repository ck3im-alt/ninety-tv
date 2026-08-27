import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, useFocusable, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import type { LeagueDef } from '../../data/sports/leagues'
import type { TeamDef } from '../../data/sports/teamCatalog'
import { useFootballCompetitions } from '../../data/sports/useFootballCompetitions'
import { useCompetitionTeams, useTeamCatalog } from '../../data/sports/useTeamCatalog'
import { suggestTeams } from '../../data/sports/teamSuggestions'
import { useDebouncedValue } from '../channels/useDebouncedValue'
import { chunkIntoRows, isRowEdge, lastRowEntry, verticalNeighbour, type FocusChain } from './focusChain'
import { orderTeamRail } from './teamRail'
import { useOnboardingLanding } from './useOnboardingLanding'
import { TeamBrowser } from './TeamBrowser'
import { TeamCard } from './TeamCard'
import { TEAM_FOCUS_PREFIX, suggestedTeamFocusKey, teamFocusKey, teamGroupFocusKey } from './teamFocusKeys'
import { OnboardingTopBar } from './OnboardingStepper'
import { BLOCK_ARROW } from './SelectableCard'
import { ONBOARDING_PRIMARY_FOCUS_KEY, OnboardingFooter } from './OnboardingActions'
import './onboardingShared.css'
import './OnboardingSportsScreen.css'

// Matches .team-grid's own `repeat(8, 1fr)`, and is also
// SUGGESTED_TEAM_LIMIT, so the suggestions are always exactly ONE row.
const SUGGESTED_GRID_COLUMNS = 8

// How long the rail has to settle before its competition's roster is
// actually fetched. Moving through the rail BROWSES (focus alone changes
// the pane — see TeamBrowser), so without this, holding Down through fifty
// competitions would fire fifty requests. The same trick, and roughly the
// same number, as the channel browser's preview debounce.
const RAIL_FETCH_DEBOUNCE_MS = 220

const currentFocusKey = (): string => (getCurrentFocusKey() as string | null) ?? ''

interface Props {
  // The leagues chosen on the previous step. Used to ORDER things — which
  // clubs to suggest, which competitions sit at the top of the rail — and
  // never to restrict them: every competition Ninety tracks is in the rail
  // regardless. See TeamBrowser's header.
  selectedLeagues: Set<string>
  // Canonical ninety-api team ids — never names. See
  // SportPreferences.favoriteTeamIds.
  selectedTeams: Set<string>
  onToggleTeam: (id: string) => void
  onBack: () => void
  onContinue: () => void
}

// ONBOARDING STEP 3 — TEAMS.
//
// A STEP, NOT A SECTION. This used to live under the league picker as an
// eight-card row plus a "Browse all teams" toggle that opened a panel into
// whatever height was left — which, on a step already carrying two sports
// cards, eight league cards and a league browser, was almost none. The
// interaction technically worked and was unusable.
//
// Given the whole canvas it is the same two ideas as the league step, at a
// size that fits them: the clubs Ninety would pick for you, pinned at the
// top, and every club it tracks in an always-open master/detail panel
// below. Nothing expands, nothing collapses, the page never scrolls.
//
// Entirely OPTIONAL, in the strong sense. A viewer can walk straight past
// it, and it must stay completable when the backend has no /v1/teams route
// at all — following clubs is a personalization signal, never a gate on
// finishing first-run setup.
export function OnboardingTeamsScreen({ selectedLeagues, selectedTeams, onToggleTeam, onBack, onContinue }: Props) {
  const competitionsState = useFootballCompetitions()
  const catalog = useMemo<LeagueDef[]>(
    () => (competitionsState.status === 'ready' ? competitionsState.leagues : []),
    [competitionsState],
  )

  // The viewer's own competitions first, then everything else — see
  // teamRail.ts. This is the whole "prioritize, don't restrict" rule.
  const rail = useMemo(() => orderTeamRail(catalog, selectedLeagues), [catalog, selectedLeagues])
  const followedLeagueIds = useMemo(
    () => rail.filter((league) => selectedLeagues.has(league.id)).map((league) => league.id),
    [rail, selectedLeagues],
  )

  // --- Suggestions -------------------------------------------------------
  // Scoped to the leagues the viewer actually picked, which is what keeps
  // this a short, obviously-relevant list rather than every club Ninety
  // tracks. Stale-while-revalidate inside the hook means changing leagues
  // (via Back) never collapses this grid — see useTeamCatalog.
  const suggestionsState = useTeamCatalog(followedLeagueIds)
  const suggestionCatalog = useMemo(
    () => (suggestionsState.status === 'ready' ? suggestionsState.teams : []),
    [suggestionsState],
  )
  const suggestedTeams = useMemo(
    () =>
      suggestTeams({
        teams: suggestionCatalog,
        competitionIds: followedLeagueIds,
        selectedTeamIds: [...selectedTeams],
      }),
    [suggestionCatalog, followedLeagueIds, selectedTeams],
  )

  // --- Browser -----------------------------------------------------------
  const [activeCompetitionId, setActiveCompetitionId] = useState<string | null>(null)
  // Resolved rather than seeded by an effect, exactly as the league
  // browser's region is: the panel has an active competition from its very
  // first render.
  const activeCompetition = useMemo(
    () => rail.find((league) => league.id === activeCompetitionId) ?? rail[0] ?? null,
    [rail, activeCompetitionId],
  )
  // Only fetch a roster once the rail has stopped moving — see
  // RAIL_FETCH_DEBOUNCE_MS.
  const fetchCompetitionId = useDebouncedValue(activeCompetition?.id ?? null, RAIL_FETCH_DEBOUNCE_MS)
  const browsedState = useCompetitionTeams(fetchCompetitionId)
  // Only trust the roster while it belongs to the competition currently on
  // screen. Between a rail move and the debounce firing, `browsedState`
  // still holds the PREVIOUS competition's clubs, and rendering those under
  // the new heading would be actively wrong rather than merely stale.
  const rosterIsCurrent = fetchCompetitionId === (activeCompetition?.id ?? null)
  const browsedTeams = useMemo<TeamDef[]>(
    () => (rosterIsCurrent && browsedState.status === 'ready' ? browsedState.teams : []),
    [rosterIsCurrent, browsedState],
  )
  const browsedStatus = rosterIsCurrent ? browsedState.status : 'loading'

  // Which competition each club Ninety has shown us belongs to, accumulated
  // across the suggestions and every roster browsed this session.
  //
  // It exists because a followed team is persisted as a bare canonical id
  // (SportPreferences.favoriteTeamIds) that carries no competition with it,
  // so "3 followed" on a rail row is unanswerable without remembering where
  // each club was seen. It only ever GROWS, so walking back up the rail
  // keeps every count already earned. A competition whose roster has not
  // been loaded this session honestly reads as 0 rather than as wrong.
  const [teamCompetition, setTeamCompetition] = useState<ReadonlyMap<string, string>>(() => new Map())
  useEffect(() => {
    const additions = [...suggestionCatalog, ...browsedTeams].filter(
      (team) => team.domesticCompetitionId && !teamCompetition.has(team.id),
    )
    if (additions.length === 0) return
    setTeamCompetition((prev) => {
      const next = new Map(prev)
      for (const team of additions) next.set(team.id, team.domesticCompetitionId as string)
      return next
    })
    // Re-runs once more after its own update, finds nothing new, and stops —
    // which is what keeps this from needing a ref mutated during render.
  }, [suggestionCatalog, browsedTeams, teamCompetition])

  const followedByCompetition = useMemo(() => {
    const counts = new Map<string, number>()
    for (const teamId of selectedTeams) {
      const competitionId = teamCompetition.get(teamId)
      if (competitionId) counts.set(competitionId, (counts.get(competitionId) ?? 0) + 1)
    }
    return counts
  }, [selectedTeams, teamCompetition])

  const railGroups = useMemo(
    () =>
      rail.map((league) => ({
        competitionId: league.id,
        label: league.name,
        meta: league.region ?? undefined,
        followedCount: followedByCompetition.get(league.id) ?? 0,
      })),
    [rail, followedByCompetition],
  )

  const hasBrowser = railGroups.length > 0 && activeCompetition != null

  // --- Focus model -------------------------------------------------------
  // The page above the panel is just the suggestions row (always one row —
  // SUGGESTED_TEAM_LIMIT equals the column count), then one row standing for
  // the panel itself. Same model as every other onboarding surface, so a
  // partial row needs no special case.
  const chain = useMemo<FocusChain>(() => {
    const rows: string[][] = [
      ...chunkIntoRows(suggestedTeams.map((team) => suggestedTeamFocusKey(team.id)), SUGGESTED_GRID_COLUMNS),
    ]
    if (hasBrowser && activeCompetition) rows.push([teamGroupFocusKey(activeCompetition.id)])
    return rows
  }, [suggestedTeams, hasBrowser, activeCompetition])

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

  // Where the panel's own Up escape lands: the suggestions row when there is
  // one, otherwise the panel is the top of the page and Up stays put.
  const aboveBrowserFocusKey = suggestedTeams[0]
    ? suggestedTeamFocusKey(suggestedTeams[0].id)
    : ONBOARDING_PRIMARY_FOCUS_KEY

  const browserReturnKeyRef = useRef<string | null>(null)
  const mountedTeamKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const group of railGroups) keys.add(teamGroupFocusKey(group.competitionId))
    for (const team of browsedTeams) keys.add(teamFocusKey(team.id))
    return keys
  }, [railGroups, browsedTeams])
  const footerUpFocusKey = useCallback(() => {
    const remembered = browserReturnKeyRef.current
    if (remembered && mountedTeamKeys.has(remembered)) return remembered
    return lastRowEntry(chain) ?? ONBOARDING_PRIMARY_FOCUS_KEY
  }, [mountedTeamKeys, chain])

  // The step's entry point, and null until there is one: the competition
  // catalogue is a fetch and the suggestions need the team catalogue on top
  // of it, so on the render this mounts on there is nothing to focus at all.
  // See useOnboardingLanding for why preferredChildFocusKey alone cannot
  // cover that (or the case of arriving here with focus on Continue).
  const landingFocusKey = suggestedTeams[0]
    ? suggestedTeamFocusKey(suggestedTeams[0].id)
    : activeCompetition
      ? teamGroupFocusKey(activeCompetition.id)
      : null
  useOnboardingLanding(landingFocusKey)

  // Changing competition replaces every card in the detail pane. Focus is
  // normally in the rail while that happens (focusing a rail row is what
  // changes it), but a click route — or a roster arriving that no longer
  // contains the focused club — can leave it pointing at a removed card.
  useEffect(() => {
    if (!hasBrowser || !activeCompetition) return
    const current = currentFocusKey()
    // Only ever rescues focus standing on a BROWSER card. A focused
    // suggestion is in its own key space (SUGGESTED_TEAM_FOCUS_PREFIX,
    // which does not begin with this one) and is never affected by the pane
    // swapping underneath it.
    if (!current.startsWith(TEAM_FOCUS_PREFIX)) return
    if (browsedTeams.some((team) => teamFocusKey(team.id) === current)) return
    void setFocus(teamGroupFocusKey(activeCompetition.id))
  }, [hasBrowser, activeCompetition, browsedTeams])

  // Nothing on this step opens or closes, so Back means the previous step.
  useBackHandler(() => {
    onBack()
    return true
  })

  const { ref, focusKey } = useFocusable({
    focusKey: 'onboarding-teams',
    trackChildren: true,
    // The first suggestion when there is one; otherwise straight into the
    // rail, which is the only other thing on the page. Falling back to the
    // primary action keeps a viewer with no catalogue at all able to move on.
    preferredChildFocusKey: landingFocusKey ?? ONBOARDING_PRIMARY_FOCUS_KEY,
  })

  const suggestionsBlocked =
    suggestionsState.status === 'unavailable' || suggestionsState.status === 'error'

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="onboarding-screen dense">
        <OnboardingTopBar current={3} />

        <div className="onboarding-heading">
          <h1 className="onboarding-headline">
            Pick the teams you <span className="accent">support</span>
          </h1>
          <p className="onboarding-description">
            Ninety puts your clubs' matches first on Home. Pick as many as you like — or skip this and add them later in
            Settings.
          </p>
        </div>

        {/* Always in panel mode: the browser is the last child and claims
            exactly the leftover height, so this page is always exactly one
            screen tall and nothing below can move anything above it. */}
        <div className={`onboarding-body ${hasBrowser ? 'browsing' : ''}`}>
          <section className="onboarding-section">
            <div className="picker-section-header">
              <h2 className="picker-section-title">
                Suggested for you
                <span className="picker-section-counter">
                  {selectedTeams.size > 0
                    ? `${selectedTeams.size} followed`
                    : 'Optional — helps Ninety put your matches first'}
                </span>
              </h2>
            </div>

            {/* Two DIFFERENT non-ready states, on purpose. "Not available
                yet" is a fact about this Ninety backend (the team catalogue
                ships separately); an error is something that went wrong.
                Neither blocks Continue. */}
            {suggestionsState.status === 'unavailable' && (
              <p className="picker-status">Following teams isn't available yet — you can add them later in Settings.</p>
            )}
            {suggestionsState.status === 'error' && (
              <p className="picker-status">Couldn't load teams right now. You can add them later in Settings.</p>
            )}
            {!suggestionsBlocked && suggestedTeams.length === 0 && (
              <p className="picker-status">
                {followedLeagueIds.length === 0
                  ? 'Pick a league on the previous step and Ninety will suggest clubs here — or browse any competition below.'
                  : 'Finding clubs from your leagues...'}
              </p>
            )}

            {suggestedTeams.length > 0 && (
              <div className="team-grid">
                {suggestedTeams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    focusKey={suggestedTeamFocusKey(team.id)}
                    selected={selectedTeams.has(team.id)}
                    onToggle={() => onToggleTeam(team.id)}
                    arrows={arrowsFor(suggestedTeamFocusKey(team.id))}
                  />
                ))}
              </div>
            )}
          </section>

          {hasBrowser && activeCompetition && (
            <TeamBrowser
              groups={railGroups}
              activeCompetitionId={activeCompetition.id}
              activeLabel={activeCompetition.name}
              teams={browsedTeams}
              status={browsedStatus}
              selectedTeamIds={selectedTeams}
              onActivateGroup={setActiveCompetitionId}
              onToggleTeam={onToggleTeam}
              exitUpFocusKey={aboveBrowserFocusKey}
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
