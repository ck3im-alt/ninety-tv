import { FocusContext, useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { SportKey } from '../../data/sports/types'
import { FOOTBALL_LEAGUES } from '../../data/sports/leagues'
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
  onArrowDown,
  children,
}: {
  focusKey: string
  selected: boolean
  onToggle: () => void
  forceFocus?: boolean
  onArrowLeft?: () => void
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
      if (direction === 'down' && onArrowDown) {
        onArrowDown()
        return false
      }
      return true
    },
  })
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

  const BACK_FOCUS_KEY = 'sports-back'
  const CONTINUE_FOCUS_KEY = 'sports-continue'
  const { ref: backRef, focused: backFocused } = useFocusable({ focusKey: BACK_FOCUS_KEY, onEnterPress: onBack })
  const { ref: skipRef, focused: skipFocused } = useFocusable({ onEnterPress: onSkip })
  const { ref: continueRef, focused: continueFocused } = useFocusable({
    focusKey: CONTINUE_FOCUS_KEY,
    onEnterPress: onContinue,
  })

  // Column count matches each grid's own CSS (`repeat(6, 1fr)` — see
  // OnboardingSportsScreen.css) — used to compute which cards sit in the
  // leftmost column (-> Left reaches Back) and in the grid's actual last
  // row (-> Down reaches Continue), since neither is reliably reachable
  // through norigin's default geometry-based search from every card. Only
  // the truly last-rendered section's last row gets the Continue escape;
  // the sports->leagues transition within the picker is a normal
  // same-column downward move that already works.
  const GRID_COLUMNS = 6
  const isLastPickerSection = !footballSelected || FOOTBALL_LEAGUES.length === 0

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

          {footballSelected && (
            <>
              <h2 className="picker-section-title">FOOTBALL LEAGUES</h2>
              <div className="league-grid">
                {FOOTBALL_LEAGUES.map((league, index) => {
                  const lastRowStart = (Math.ceil(FOOTBALL_LEAGUES.length / GRID_COLUMNS) - 1) * GRID_COLUMNS
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
                      <span className="pick-card-label">{leagueDisplayName(league.id)}</span>
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

// TheSportsDB's strLeague names are already display-ready (e.g. "English
// Premier League") but longer than the reference design's short labels
// ("Premier League") — this is a small display-only rename, not a data
// change; leagues.ts still carries the full names.
function leagueDisplayName(id: string): string {
  const overrides: Record<string, string> = {
    '4328': 'Premier League',
    '4480': 'UEFA Champions League',
    '4335': 'LaLiga',
    '4332': 'Serie A',
    '4331': 'Bundesliga',
    '4334': 'Ligue 1',
    '4337': 'Eredivisie',
    '4344': 'Primeira Liga',
    '4346': 'MLS',
    '4329': 'Championship',
    '4481': 'Europa League',
    '5071': 'Conference League',
  }
  return overrides[id] ?? id
}
