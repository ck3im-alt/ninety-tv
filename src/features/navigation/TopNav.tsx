import { useEffect, useState } from 'react'
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
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

// Each item's spatial-nav focus key is derived from its LABEL (`nav-${label}`
// in NavItem below), so renaming one renames its focus key — nothing in the
// app hardcodes `nav-Competitions`/`nav-Schedule`, and Down out of the bar is
// resolved geometrically (or via downFocusKey), so no navigation depends on
// these strings.
const NAV_ITEMS = ['Home', 'Schedule', 'Channels'] as const

// Opt-in escape hatch for screens whose first focusable doesn't sit
// underneath the nav bar. Norigin only treats two elements as adjacent when
// they overlap by >=20%, which holds for Home (hero button under the nav
// items) but not for e.g. the standalone playlist setup screen, whose form
// starts on the far left while the avatar sits on the far right — Down from
// the avatar there found nothing and dropped focus onto the invisible
// screen root. Screens that don't pass one keep the existing purely
// geometric behaviour, unchanged.
function useNavDownEscape(downFocusKey?: string) {
  return (direction: string) => {
    if (direction === 'down' && downFocusKey) {
      void setFocus(downFocusKey)
      return false
    }
    return true
  }
}

interface NavItemProps {
  label: string
  active: boolean
  onSelect?: () => void
  downFocusKey?: string
}

function NavItem({ label, active, onSelect, downFocusKey }: NavItemProps) {
  // `focusable: onSelect != null` — a nav item with no handler (e.g.
  // Channels while playlist hydration is still pending, see App.tsx) must
  // not be a spatial-nav target at all. It used to always register, so a
  // remote user could focus and press Enter on it and nothing would happen
  // — a dead target that only "worked" by luck of onClick being undefined.
  const { ref, focused } = useFocusable({
    focusKey: `nav-${label}`,
    focusable: onSelect != null,
    onEnterPress: onSelect,
    onArrowPress: useNavDownEscape(downFocusKey),
  })
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

function Avatar({ onSelect, downFocusKey }: { onSelect?: () => void; downFocusKey?: string }) {
  const { ref, focused } = useFocusable({
    focusKey: 'nav-avatar',
    focusable: onSelect != null,
    onEnterPress: onSelect,
    onArrowPress: useNavDownEscape(downFocusKey),
  })
  useFocusScrollIntoView(ref, focused)
  return (
    <div ref={ref} className={`avatar ${onSelect ? 'clickable' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      N
    </div>
  )
}

function AdminDevButton({ onSelect, downFocusKey }: { onSelect: () => void; downFocusKey?: string }) {
  const { ref, focused } = useFocusable({
    focusKey: 'nav-admin-dev',
    onEnterPress: onSelect,
    onArrowPress: useNavDownEscape(downFocusKey),
  })
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
  onSelectSchedule?: () => void
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
  // Where Down out of the nav bar should land, for screens whose own first
  // focusable isn't geometrically below it — see useNavDownEscape.
  downFocusKey?: string
}

export function TopNav({
  activeItem = 'Home',
  onSelectHome,
  onSelectChannels,
  onSelectSchedule,
  onOpenSettings,
  onOpenAdmin,
  downFocusKey,
}: TopNavProps) {
  const { ref, focusKey } = useFocusable({ focusKey: 'top-nav', trackChildren: true })
  const clock = useClock()
  const handlers: Partial<Record<(typeof NAV_ITEMS)[number], () => void>> = {
    Home: onSelectHome,
    Channels: onSelectChannels,
    Schedule: onSelectSchedule,
  }
  return (
    <FocusContext.Provider value={focusKey}>
      <header ref={ref} className="top-nav">
        <div className="logo">N I N E T Y</div>
        <nav className="nav-items">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item} label={item} active={item === activeItem} onSelect={handlers[item]} downFocusKey={downFocusKey} />
          ))}
        </nav>
        <div className="nav-meta">
          {onOpenAdmin && <AdminDevButton onSelect={onOpenAdmin} downFocusKey={downFocusKey} />}
          <Avatar onSelect={onOpenSettings} downFocusKey={downFocusKey} />
          <span className="clock">{clock}</span>
        </div>
      </header>
    </FocusContext.Provider>
  )
}
