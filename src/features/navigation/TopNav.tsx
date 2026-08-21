import { useEffect, useState } from 'react'
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import './TopNav.css'

function useClock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000 * 30)
    return () => clearInterval(id)
  }, [])
  return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const NAV_ITEMS = ['Home', 'Competitions', 'Channels'] as const

interface NavItemProps {
  label: string
  active: boolean
  onSelect?: () => void
}

function NavItem({ label, active, onSelect }: NavItemProps) {
  // `focusable: onSelect != null` — a nav item with no handler (e.g.
  // Channels while playlist hydration is still pending, see App.tsx) must
  // not be a spatial-nav target at all. It used to always register, so a
  // remote user could focus and press Enter on it and nothing would happen
  // — a dead target that only "worked" by luck of onClick being undefined.
  const { ref, focused } = useFocusable({ focusKey: `nav-${label}`, focusable: onSelect != null, onEnterPress: onSelect })
  // TopNav sits in normal document flow above Home's content (not a fixed
  // overlay), so moving focus up into it from a Home row scrolled deep down
  // the page needs the same scroll-follow every other Home focus target
  // gets — otherwise the nav item "receives" focus while the page stays
  // scrolled down and the whole bar is offscreen above it.
  useFocusScrollIntoView(ref, focused)
  return (
    <div
      ref={ref}
      className={`nav-item ${active ? 'active' : ''} ${focused ? 'focused' : ''} ${onSelect ? 'clickable' : ''}`}
      onClick={onSelect}
    >
      {label}
      {active && <span className="nav-underline" />}
    </div>
  )
}

function Avatar({ onSelect }: { onSelect?: () => void }) {
  const { ref, focused } = useFocusable({ focusKey: 'nav-avatar', focusable: onSelect != null, onEnterPress: onSelect })
  useFocusScrollIntoView(ref, focused)
  return (
    <div ref={ref} className={`avatar ${onSelect ? 'clickable' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      N
    </div>
  )
}

function AdminDevButton({ onSelect }: { onSelect: () => void }) {
  const { ref, focused } = useFocusable({ focusKey: 'nav-admin-dev', onEnterPress: onSelect })
  useFocusScrollIntoView(ref, focused)
  return (
    <div ref={ref} className={`nav-admin-dev clickable ${focused ? 'focused' : ''}`} onClick={onSelect} title="Dev/debug panel">
      ⚙
    </div>
  )
}

interface TopNavProps {
  activeItem?: string
  onSelectHome?: () => void
  onSelectChannels?: () => void
  onSelectCompetitions?: () => void
  // The profile avatar's production entry point — a real Settings screen
  // (favorite sports/leagues/countries, same data onboarding writes). Always
  // wired up, dev and prod alike, so Settings itself gets exercised in
  // development rather than only the dev-only admin panel below.
  onOpenSettings?: () => void
  // Dev/debug panel (reset onboarding/preferences for testing) — has its
  // own small entry point next to the avatar, only rendered in dev builds.
  // Never wired to the avatar itself: production must never expose this,
  // and reusing the avatar for both would mean dev testing never exercises
  // the real production Settings entry point.
  onOpenAdmin?: () => void
}

export function TopNav({
  activeItem = 'Home',
  onSelectHome,
  onSelectChannels,
  onSelectCompetitions,
  onOpenSettings,
  onOpenAdmin,
}: TopNavProps) {
  const { ref, focusKey } = useFocusable({ focusKey: 'top-nav', trackChildren: true })
  const clock = useClock()
  const handlers: Partial<Record<(typeof NAV_ITEMS)[number], () => void>> = {
    Home: onSelectHome,
    Channels: onSelectChannels,
    Competitions: onSelectCompetitions,
  }
  return (
    <FocusContext.Provider value={focusKey}>
      <header ref={ref} className="top-nav">
        <div className="logo">N I N E T Y</div>
        <nav className="nav-items">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item} label={item} active={item === activeItem} onSelect={handlers[item]} />
          ))}
        </nav>
        <div className="nav-meta">
          {onOpenAdmin && <AdminDevButton onSelect={onOpenAdmin} />}
          <Avatar onSelect={onOpenSettings} />
          <span className="clock">{clock}</span>
        </div>
      </header>
    </FocusContext.Provider>
  )
}
