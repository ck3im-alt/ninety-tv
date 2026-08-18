import { useEffect, useRef } from 'react'
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation'
import { useHomeFeed } from '../../data/sports/useHomeFeed'
import type { SportEvent } from '../../data/sports/types'
import { loadPreferences } from '../../data/preferences'
import { useFavoriteChannelsNowPlaying } from './useFavoriteChannelsNowPlaying'
import type { FavoriteChannelNowPlaying } from './useFavoriteChannelsNowPlaying'
import type { Channel, ChannelSource } from '../../data/channel'
import type { XtreamCredentials } from '../../data/xtream/types'
import type { ChannelIdentityIndex } from '../../data/sports/channelIdentityIndex'
import { ArrowRightIcon, FootballIcon, FormulaOneIcon } from '../onboarding/sportIcons'
import './HomeScreen.css'

function CalendarIcon() {
  return (
    <svg className="meta-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 6h13" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 1.5v2M11.5 1.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function VenueIcon() {
  return (
    <svg className="meta-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <ellipse cx="8" cy="8" rx="6.8" ry="4.2" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="8" cy="8" rx="3.6" ry="2.1" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

const SPORT_ICONS: Record<string, () => React.JSX.Element> = {
  football: FootballIcon,
  f1: FormulaOneIcon,
}

function Hero({
  event,
  isWatchableNow,
  onSelect,
}: {
  event: SportEvent | null
  isWatchableNow: boolean
  onSelect: (event: SportEvent) => void
}) {
  // Norigin's setFocus(ROOT_FOCUS_KEY) only lands on a component that opts
  // in with forceFocus — without one, nothing is ever focused and arrow
  // keys have nothing to navigate from.
  const { ref, focused } = useFocusable({
    focusKey: 'watch-now',
    forceFocus: true,
    onEnterPress: () => event && onSelect(event),
  })

  if (!event) {
    return (
      <section className="hero hero-empty">
        <div className="hero-background" />
        <div className="hero-nav-scrim" />
        <div className="hero-content">
          <p className="hero-competition">No upcoming fixtures found</p>
        </div>
      </section>
    )
  }

  return (
    <section className="hero">
      {event.backgroundUrl ? (
        <img className="hero-background hero-background-image" src={event.backgroundUrl} alt="" />
      ) : (
        <div className="hero-background" />
      )}
      <div className="hero-nav-scrim" />
      <div className="hero-content">
        {event.isLive && (
          // The hero previously had no way of saying "live" at all — only
          // the Watch Now/Event Preview button text hinted at it, and that
          // also covers "starting within the hour" (not actually live
          // yet), so it wasn't a reliable live signal on its own. Same
          // badge style as Live Now's cards, real score/clock only shown
          // for real live data (never for a heuristic-live guess — see
          // isLiveHeuristic on SportEvent).
          <span className="hero-live-badge">
            <span className="hero-live-dot" /> LIVE{!event.isLiveHeuristic && event.liveClock ? ` · ${event.liveClock}` : ''}
          </span>
        )}
        {event.league && (
          <div className="hero-league">
            {/* Crest image dropped — black line art on a dark photo needed
                a backdrop/glow/outline and none of them looked right (see
                git history). Plain white text reads cleanly with no extra
                treatment needed. */}
            <span className="hero-league-name">{event.league}</span>
            {event.round && (event.homeTeam && event.awayTeam) && (
              // Football fixtures (ninety-api) already carry a full,
              // human-readable round name here — e.g. "Matchweek 12" — so
              // it's shown as-is rather than behind a hardcoded prefix (see
              // mapNinetyEvent in mapEvent.ts). Own line under the
              // competition name, not inline with it.
              <span className="hero-competition">{event.round.toUpperCase()}</span>
            )}
          </div>
        )}
        <h1 className="hero-title">
          {event.homeTeam && event.awayTeam ? (
            <>
              {event.homeTeam}
              {event.homeScore != null && <span className="hero-score">{event.homeScore}</span>}
              <br />
              <span className="vs">vs</span> {event.awayTeam}
              {event.awayScore != null && <span className="hero-score">{event.awayScore}</span>}
            </>
          ) : (
            event.title
          )}
        </h1>
        <div className="hero-meta">
          <span className="hero-meta-item">
            <CalendarIcon />
            {event.timeLabel}
          </span>
          {event.venue && (
            <span className="hero-meta-item">
              <VenueIcon />
              {event.venue}
            </span>
          )}
        </div>
        {/* This is the hero's only way of saying "you can actually watch
            this right now" vs. "this is just what's coming up next" —
            selectHero (heroScoring.ts) only marks something watchable when
            it's live or starting within the hour, so the label has to
            match: promising "Watch Now" for something two days out would
            be a lie the button can't back up (it isn't wired to playback
            yet either way — this only fixes the label, not the action). */}
        <button ref={ref} className={`watch-now ${focused ? 'focused' : ''}`} onClick={() => onSelect(event)}>
          {isWatchableNow ? <>▶ Watch Now</> : 'Event Preview'}
        </button>
      </div>
    </section>
  )
}

// Shared by both Live Now and Coming Up cards — competition footer (crest
// + name) is the same real data (event.leagueBadge/event.league) either
// way.
function CardCompetition({ event }: { event: SportEvent }) {
  return (
    <div className="card-competition">
      {event.leagueBadge && <img src={event.leagueBadge} alt="" />}
      <span>{event.league}</span>
    </div>
  )
}

// The body of a card: two team/player rows with scores when we have a
// real fixture, or a single-entrant sport icon + title when there's no
// "vs" (F1 sessions, golf rounds, UFC cards — also every heuristic-live
// event, since those never carry a score even if they do have two named
// sides).
function CardBody({ event }: { event: SportEvent }) {
  if (event.homeTeam && event.awayTeam) {
    return (
      <div className="card-teams">
        <div className="card-team-row">
          <span className="card-team-name">
            {event.homeBadge && <img className="card-team-badge" src={event.homeBadge} alt="" />}
            {event.homeTeam}
          </span>
          {event.homeScore != null && <span className="card-team-score">{event.homeScore}</span>}
        </div>
        <div className="card-team-row">
          <span className="card-team-name">
            {event.awayBadge && <img className="card-team-badge" src={event.awayBadge} alt="" />}
            {event.awayTeam}
          </span>
          {event.awayScore != null && <span className="card-team-score">{event.awayScore}</span>}
        </div>
      </div>
    )
  }

  const Icon = SPORT_ICONS[event.sportKey]
  return (
    <div className="card-single">
      {Icon && (
        <div className="card-single-icon">
          <Icon />
        </div>
      )}
      <span className="card-single-title">{event.title}</span>
    </div>
  )
}

function LiveNowCard({ event, onSelect }: { event: SportEvent; onSelect: (event: SportEvent) => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: () => onSelect(event) })
  // The spatial-nav library moves focus but never scrolls — .scroll-row
  // scrolls its own horizontal overflow, so the newly focused card has to
  // be scrolled into view manually (same pattern as ListRow.tsx's vertical
  // lists) or arrow-key navigation silently walks off the visible row.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [focused, ref])
  return (
    <div ref={ref} className={`event-card ${focused ? 'focused' : ''}`} onClick={() => onSelect(event)}>
      <div className="event-card-header">
        <span className="live-badge">
          <span className="live-dot" /> LIVE
        </span>
        <span className="sport-label">{event.sportLabel}</span>
        {/* Only real football live data has a clock (see isLiveHeuristic
            on SportEvent) — a guessed-live F1/tennis card never claims a
            score or time it doesn't actually have. */}
        {!event.isLiveHeuristic && event.liveClock && <span className="event-card-clock">{event.liveClock}</span>}
      </div>
      <CardBody event={event} />
      <CardCompetition event={event} />
    </div>
  )
}

function ComingUpCard({ event, onSelect }: { event: SportEvent; onSelect: (event: SportEvent) => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: () => onSelect(event) })
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [focused, ref])
  return (
    <div ref={ref} className={`event-card ${focused ? 'focused' : ''}`} onClick={() => onSelect(event)}>
      <div className="event-card-header">
        <span className="event-card-time">{event.timeLabel.replace(/^Today /, '')}</span>
        <span className="sport-label">{event.sportLabel}</span>
      </div>
      <CardBody event={event} />
      <CardCompetition event={event} />
    </div>
  )
}

// Both Live Now and Coming Up are wider than the screen once there's
// real data (7+ football leagues alone) — a circular chevron scrolls the
// row instead of hard-capping how many cards exist.
function ScrollRow({ children }: { children: React.ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const { ref: chevronRef, focused: chevronFocused } = useFocusable({
    onEnterPress: () => rowRef.current?.scrollBy({ left: 420, behavior: 'smooth' }),
  })
  return (
    <div className="scroll-row-wrap">
      <div ref={rowRef} className="scroll-row">
        {children}
      </div>
      <button
        ref={chevronRef}
        className={`scroll-chevron ${chevronFocused ? 'focused' : ''}`}
        onClick={() => rowRef.current?.scrollBy({ left: 420, behavior: 'smooth' })}
        aria-label="Show more"
      >
        <ArrowRightIcon />
      </button>
    </div>
  )
}

// One card per favorited channel — see useFavoriteChannelsNowPlaying.ts
// for why this section exists at all: it's the replacement for per-sport
// broadcast-matching (golf/tennis/MMA/basketball) that got dropped for
// lack of any real broadcast-data provider. The user favorites the
// channel themselves and sees what's actually on right now, rather than
// us guessing.
function FavoriteChannelCard({ entry, onWatch }: { entry: FavoriteChannelNowPlaying; onWatch: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onWatch })
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [focused, ref])
  const { channel, title } = entry
  return (
    <div ref={ref} className={`event-card favorite-channel-card ${focused ? 'focused' : ''}`} onClick={onWatch}>
      <div className="favorite-channel-header">
        {channel.logo && <img className="favorite-channel-logo" src={channel.logo} alt="" />}
        <span className="favorite-channel-name">{channel.name}</span>
      </div>
      <p className="favorite-channel-title">{title ?? 'No programme info available'}</p>
    </div>
  )
}

export function HomeScreen({
  onSelectEvent,
  onWatchChannel,
  channels,
  xtreamCreds,
  identityIndex,
  favoriteChannels,
}: {
  onSelectEvent: (event: SportEvent) => void
  onWatchChannel: (channel: Channel, source: ChannelSource) => void
  channels: Channel[]
  xtreamCreds: XtreamCredentials | null
  identityIndex: ChannelIdentityIndex | null
  favoriteChannels: Channel[]
}) {
  const { ref, focusKey } = useFocusable({ focusKey: 'home-screen', trackChildren: true })
  // Preferences only change via the onboarding screen (which remounts the
  // app screen on Continue/Skip), so reading once per mount is enough —
  // no need to subscribe to storage changes here. channels/xtreamCreds are
  // needed now too — Live Now filters out football matches with no
  // findable channel in the playlist (see useHomeFeed.ts).
  const feedState = useHomeFeed(loadPreferences(), channels, xtreamCreds, identityIndex)
  const { feed } = feedState
  const favoriteChannelsNowPlaying = useFavoriteChannelsNowPlaying(favoriteChannels, xtreamCreds)

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="home-screen">
        <Hero event={feed.hero} isWatchableNow={feed.heroIsWatchableNow} onSelect={onSelectEvent} />
        {/* Hero is position:absolute (see HomeScreen.css) so it can bleed
            up behind TopNav and reach the true top of the app — this
            reserves the flow space it would otherwise occupy so Live
            Now/Tonight land in the right place below it. */}
        <div className="hero-spacer" aria-hidden="true" />

        {feedState.status === 'error' && (
          <p className="feed-status feed-status-error">Couldn't load fixtures: {feedState.message}</p>
        )}
        {feedState.status === 'partial' && <p className="feed-status feed-status-error">{feedState.message}</p>}
        {feedState.status === 'loading' && <p className="feed-status">Loading fixtures…</p>}

        <section className="row">
          <h2 className="row-title">Live Now</h2>
          {feed.liveNow.length > 0 ? (
            <ScrollRow>
              {feed.liveNow.map((event) => (
                <LiveNowCard key={event.id} event={event} onSelect={onSelectEvent} />
              ))}
            </ScrollRow>
          ) : (
            (feedState.status === 'ready' || feedState.status === 'partial') && (
              <p className="feed-status">No ongoing matches in the top 5 leagues or UEFA competitions right now.</p>
            )
          )}
        </section>

        {favoriteChannelsNowPlaying.length > 0 && (
          <section className="row">
            <h2 className="row-title">Your Favorite Channels</h2>
            <ScrollRow>
              {favoriteChannelsNowPlaying.map((entry) => (
                <FavoriteChannelCard
                  key={entry.channel.id}
                  entry={entry}
                  onWatch={() => {
                    const source = entry.channel.sources[0]
                    if (source) onWatchChannel(entry.channel, source)
                  }}
                />
              ))}
            </ScrollRow>
          </section>
        )}

        <section className="row">
          <h2 className="row-title">Coming Up</h2>
          {feed.tonight.length > 0 ? (
            <ScrollRow>
              {feed.tonight.map((event) => (
                <ComingUpCard key={event.id} event={event} onSelect={onSelectEvent} />
              ))}
            </ScrollRow>
          ) : (
            (feedState.status === 'ready' || feedState.status === 'partial') && (
              <p className="feed-status">No upcoming fixtures in this window.</p>
            )
          )}
        </section>
      </main>
    </FocusContext.Provider>
  )
}
