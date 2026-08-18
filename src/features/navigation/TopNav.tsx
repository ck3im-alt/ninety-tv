import { useEffect, useState } from 'react'
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import './TopNav.css'

function useClock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000 * 30)
    return () => clearInterval(id)
  }, [])
  return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const NAV_ITEMS = ['Home', 'Matches', 'Live', 'Competitions', 'Channels'] as const

interface NavItemProps {
  label: string
  active: boolean
  onSelect?: () => void
}

function NavItem({ label, active, onSelect }: NavItemProps) {
  const { ref, focused } = useFocusable({ focusKey: `nav-${label}`, onEnterPress: onSelect })
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
  const { ref, focused } = useFocusable({ focusKey: 'nav-avatar', onEnterPress: onSelect })
  return (
    <div ref={ref} className={`avatar ${onSelect ? 'clickable' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      N
    </div>
  )
}

interface TopNavProps {
  activeItem?: string
  // Only Home/Channels/Competitions go anywhere right now — Matches/Live
  // have no screens built yet (see TIZEN-PLAN.md Steg 22 candidates), so
  // they're intentionally left non-interactive rather than navigating
  // somewhere misleading.
  onSelectHome?: () => void
  onSelectChannels?: () => void
  onSelectCompetitions?: () => void
  // Profile avatar doubles as the entry point to the dev-only admin panel
  // (reset onboarding/preferences for testing) — there's no real profile
  // screen behind it yet.
  onOpenAdmin?: () => void
}

export function TopNav({ activeItem = 'Home', onSelectHome, onSelectChannels, onSelectCompetitions, onOpenAdmin }: TopNavProps) {
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
          <Avatar onSelect={onOpenAdmin} />
          <span className="clock">{clock}</span>
        </div>
      </header>
    </FocusContext.Provider>
  )
}
