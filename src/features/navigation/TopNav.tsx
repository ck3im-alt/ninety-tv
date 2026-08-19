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

const NAV_ITEMS = ['Home', 'Competitions', 'Channels'] as const

interface NavItemProps {
  label: string
  active: boolean
  onSelect?: () => void
}

function NavItem({ label, active, onSelect }: NavItemProps) {
  const { ref, focused } = useFocusable({ focusKey: `nav-${label}`, onEnterPress: onSelect })
  // TopNav sits in normal document flow above Home's content (not a fixed
  // overlay), so moving focus up into it from a Home row scrolled deep down
  // the page needs the same scroll-follow every other Home focus target
  // gets — otherwise the nav item "receives" focus while the page stays
  // scrolled down and the whole bar is offscreen above it.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, ref])
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
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, ref])
  return (
    <div ref={ref} className={`avatar ${onSelect ? 'clickable' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      N
    </div>
  )
}

interface TopNavProps {
  activeItem?: string
  onSelectHome?: () => void
  onSelectChannels?: () => void
  onSelectCompetitions?: () => void
  // Profile avatar doubles as the entry point to the dev-only admin panel
  // (reset onboarding/preferences for testing) — there's no real profile
  // screen behind it yet. Only wired up in dev builds (see App.tsx); in
  // production this stays undefined and the avatar is non-interactive.
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
