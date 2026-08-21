import { useEffect } from 'react'
import { FocusContext, useFocusable, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation'
import type { SportKey } from '../../data/sports/types'
import { useFootballCompetitions } from '../../data/sports/useFootballCompetitions'
import { OnboardingTopBar } from './OnboardingStepper'
import { ArrowRightIcon, BackArrowIcon, CheckIcon, FootballIcon, FormulaOneIcon, StarIcon, TrophyIcon, TuneIcon } from './sportIcons'
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

interface Props {
  selectedSports: Set<SportKey>
  selectedLeagues: Set<string>
  onToggleSport: (id: SportKey) => void
  onToggleLeague: (id: string) => void
  onBack: () => void
  onSkip: () => void
  onContinue: () => void
}

export function SelectableCard({
  focusKey,
  selected,
  onToggle,
  forceFocus,
  // These grids sit in a two-column layout where the "escape" targets
  // (Back/Skip in the left info panel, Continue below the grid) are often
  // far enough away, or narrow enough, that norigin's geometry-based
  // directional search can't reliably reach them -- see the onArrowLeft/
  // onArrowDown wiring at each grid's call site for exactly which cards
  // get which override. Same onArrowPress-returns-false-to-override
  // pattern as ListRow.tsx/BrowseCascadeScreen.tsx use for the identical
  // problem in the channel browser.
  onArrowLeft,
  onArrowUp,
  onArrowDown,
  children,
}: {
  focusKey: string
  selected: boolean
  onToggle: () => void
  forceFocus?: boolean
  onArrowLeft?: () => void
  // Escapes UP out of the topmost row of a grid — e.g. Settings' Countries
  // grid back to the section above it, where default geometry can't be
  // trusted any more than it can for onArrowLeft/onArrowDown (see those).
  onArrowUp?: () => void
  onArrowDown?: () => void
  children: React.ReactNode
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onToggle,
    forceFocus,
    onArrowPress: (direction) => {
      if (direction === 'left' && onArrowLeft) {
        onArrowLeft()
        return false
      }
      if (direction === 'up' && onArrowUp) {
        onArrowUp()
        return false
      }
      if (direction === 'down' && onArrowDown) {
        onArrowDown()
        return false
      }
      return true
    },
  })
  // Every other focusable grid/list in the app scrolls itself into view on
  // focus (see HomeScreen/TopNav/StreamRow/ListRow) -- these onboarding
  // grids never had it, so D-pad navigation past the visible rows moved
  // focus without the viewport following it: keys registered (state did
  // toggle) but looked completely unresponsive since the focused card was
  // off-screen. Became a real, reproducible bug once the leagues grid grew
  // to 50 competitions (was 7) and stopped fitting on one screen.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, ref])
  return (
    <div
      ref={ref}
      className={`pick-card ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
      onClick={onToggle}
    >
      <span className="pick-card-checkbox">{selected && <CheckIcon />}</span>
      {children}
    </div>
  )
}

export function OnboardingSportsScreen({
  selectedSports,
  selectedLeagues,
  onToggleSport,
  onToggleLeague,
  onBack,
  onSkip,
  onContinue,
}: Props) {
  const { ref, focusKey } = useFocusable({ focusKey: 'onboarding-sports', trackChildren: true })
  const footballSelected = selectedSports.has('football')
  // Competition catalog is now an async fetch (GET /v1/competitions) —
  // see competitionsCatalog.ts — rather than a hardcoded local array.
  const competitionsState = useFootballCompetitions()
  const footballLeagues = competitionsState.status === 'ready' ? competitionsState.leagues : []

  const BACK_FOCUS_KEY = 'sports-back'
  const CONTINUE_FOCUS_KEY = 'sports-continue'
  const { ref: backRef, focused: backFocused } = useFocusable({ focusKey: BACK_FOCUS_KEY, onEnterPress: onBack })
  const { ref: skipRef, focused: skipFocused } = useFocusable({ onEnterPress: onSkip })
  const { ref: continueRef, focused: continueFocused } = useFocusable({
    focusKey: CONTINUE_FOCUS_KEY,
    onEnterPress: onContinue,
  })

  // Every standalone (non-grid-card) focus target on this screen needs its
  // own scroll-into-view -- SelectableCard has one (see below), these
  // didn't: reachable in principle (setFocus + the onArrowDown override
  // above do transfer focus here), but with 50 leagues the button sits
  // below the fold and the viewport never followed, so it looked like Down
  // silently stopped working a row or two before the actual end.
  useEffect(() => {
    if (backFocused) backRef.current?.scrollIntoView({ block: 'nearest' })
  }, [backFocused, backRef])
  useEffect(() => {
    if (skipFocused) skipRef.current?.scrollIntoView({ block: 'nearest' })
  }, [skipFocused, skipRef])
  useEffect(() => {
    if (continueFocused) continueRef.current?.scrollIntoView({ block: 'nearest' })
  }, [continueFocused, continueRef])

  // Column count matches each grid's own CSS (`repeat(6, 1fr)` — see
  // OnboardingSportsScreen.css) — used to compute which cards sit in the
  // leftmost column (-> Left reaches Back) and in the grid's actual last
  // row (-> Down reaches Continue), since neither is reliably reachable
  // through norigin's default geometry-based search from every card. Only
  // the truly last-rendered section's last row gets the Continue escape;
  // the sports->leagues transition within the picker is a normal
  // same-column downward move that already works.
  const GRID_COLUMNS = 6
  const isLastPickerSection = !footballSelected || footballLeagues.length === 0

  // Deselecting Football removes the entire league grid — normally that
  // only happens via Enter directly on the Football card, so focus is
  // already sitting there and nothing is orphaned. But this stays cheap
  // insurance against exactly the scenario the interaction audit calls
  // out (focus stranded inside a grid that just disappeared) for any other
  // path that might toggle it later: only redirects when the currently
  // focused key actually WAS one of the now-removed league cards.
  useEffect(() => {
    if (!footballSelected && getCurrentFocusKey().startsWith('league-')) {
      void setFocus('sport-football')
    }
  }, [footballSelected])

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="onboarding-screen">
        <OnboardingTopBar current={2} />

        <div className="onboarding-info">
          <h1 className="onboarding-headline">
            Choose your
            <br />
            favorite sports
          </h1>
          <p className="onboarding-description">
            Select the sports and leagues you love. We'll personalize your experience based on your selections.
          </p>

          <ul className="onboarding-features">
            <li>
              <StarIcon />
              <div>
                <p className="feature-title">Personalized for you</p>
                <p className="feature-desc">Get recommendations and highlights from your favorite leagues.</p>
              </div>
            </li>
            <li>
              <TrophyIcon />
              <div>
                <p className="feature-title">Faster access</p>
                <p className="feature-desc">Jump straight to what you care about most.</p>
              </div>
            </li>
            <li>
              <TuneIcon />
              <div>
                <p className="feature-title">You can change this anytime</p>
                <p className="feature-desc">Update your preferences in settings whenever you want.</p>
              </div>
            </li>
          </ul>

          <div className="onboarding-footer-actions">
            <button ref={backRef} className={`back-button ${backFocused ? 'focused' : ''}`} onClick={onBack}>
              <BackArrowIcon /> Back
            </button>
            <button ref={skipRef} className={`skip-button ${skipFocused ? 'focused' : ''}`} onClick={onSkip}>
              Skip for now
            </button>
          </div>
        </div>

        <div className="onboarding-picker">
          <div className={`sports-section ${footballSelected ? '' : 'centered'}`}>
            <h2 className="picker-section-title">POPULAR SPORTS</h2>
            <div className="popular-sports-grid">
              {POPULAR_SPORTS.map((sport, index) => {
                const Icon = sport.icon
                return (
                  <SelectableCard
                    key={sport.id}
                    focusKey={`sport-${sport.id}`}
                    selected={selectedSports.has(sport.id)}
                    onToggle={() => onToggleSport(sport.id)}
                    forceFocus={sport.id === 'football'}
                    onArrowLeft={index % GRID_COLUMNS === 0 ? () => void setFocus(BACK_FOCUS_KEY) : undefined}
                    onArrowDown={isLastPickerSection ? () => void setFocus(CONTINUE_FOCUS_KEY) : undefined}
                  >
                    <div className="pick-card-icon">
                      <Icon />
                    </div>
                    <span className="pick-card-label">{sport.label}</span>
                  </SelectableCard>
                )
              })}
            </div>
          </div>

          {footballSelected && competitionsState.status === 'loading' && (
            <p className="picker-status">Loading competitions…</p>
          )}
          {footballSelected && competitionsState.status === 'error' && (
            <p className="picker-status">{competitionsState.message}</p>
          )}

          {footballSelected && footballLeagues.length > 0 && (
            <>
              <h2 className="picker-section-title">FOOTBALL LEAGUES</h2>
              <div className="league-grid">
                {footballLeagues.map((league, index) => {
                  const lastRowStart = (Math.ceil(footballLeagues.length / GRID_COLUMNS) - 1) * GRID_COLUMNS
                  return (
                    <SelectableCard
                      key={league.id}
                      focusKey={`league-${league.id}`}
                      selected={selectedLeagues.has(league.id)}
                      onToggle={() => onToggleLeague(league.id)}
                      onArrowLeft={index % GRID_COLUMNS === 0 ? () => void setFocus(BACK_FOCUS_KEY) : undefined}
                      onArrowDown={index >= lastRowStart ? () => void setFocus(CONTINUE_FOCUS_KEY) : undefined}
                    >
                      <div className="pick-card-icon">
                        {league.badge && <img src={league.badge} alt="" />}
                      </div>
                      <span className="pick-card-label">{league.name}</span>
                    </SelectableCard>
                  )
                })}
              </div>
            </>
          )}

          {/* norigin's Down-navigation only considers a target "adjacent" if it
              overlaps at least 20% of the reference card's width. The visible
              button is narrow and right-aligned, so cards on the left/middle
              of the (up to 6-wide) league grid never overlap it and Down does
              nothing from there. Widening the focusable ref itself to the
              full row (while keeping the button visually right-aligned
              inside it) makes it reachable from every column. */}
          <div ref={continueRef} className="continue-button-hitbox">
            <button className={`continue-button ${continueFocused ? 'focused' : ''}`} onClick={onContinue}>
              Continue <ArrowRightIcon />
            </button>
          </div>
        </div>
      </main>
    </FocusContext.Provider>
  )
}
