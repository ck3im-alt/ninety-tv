// Remote-control key handling shared across platforms (Tizen remote, browser
// keyboard for dev, and later Google TV/webOS). Everything platform-specific
// funnels through here so features never touch raw keyCodes.

export const NavIntent = {
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
  Enter: 'enter',
  Back: 'back',
} as const

export type NavIntent = (typeof NavIntent)[keyof typeof NavIntent]

// Tizen remote keyCodes differ from standard browser keyCodes for the keys
// that matter most (Back). Arrow/Enter codes match standard DOM keyCodes on
// Tizen's WebKit as well, so one table covers both Tizen and browser/dev use.
const KEY_CODE_TO_INTENT: Record<number, NavIntent> = {
  37: NavIntent.Left,
  38: NavIntent.Up,
  39: NavIntent.Right,
  40: NavIntent.Down,
  13: NavIntent.Enter,
  10009: NavIntent.Back, // Tizen remote "Back"/"Return" key
  27: NavIntent.Back, // browser Escape, dev-only fallback
}

export function keyEventToIntent(event: KeyboardEvent): NavIntent | null {
  return KEY_CODE_TO_INTENT[event.keyCode] ?? null
}

export function isTizen(): boolean {
  return typeof window !== 'undefined' && window.tizen != null
}

// Tizen requires opting in to receive certain remote keys as DOM events;
// arrows/Enter work without registration, Back and media keys do not.
const REMOTE_KEYS_TO_REGISTER = ['Back', 'MediaPlayPause', 'MediaRewind', 'MediaFastForward']

export function registerTizenRemoteKeys(): void {
  if (!isTizen()) return
  const inputDevice = window.tizen!.tvinputdevice
  // getSupportedKeys() throws (SecurityError) if the tvinputdevice privilege
  // is ever missing/revoked — arrow/Enter navigation doesn't depend on this
  // registration succeeding (see the module comment above), so a failure
  // here must degrade to "Back/media keys don't work" rather than aborting
  // the whole boot sequence before React ever mounts.
  let supported: Set<string>
  try {
    supported = new Set(inputDevice.getSupportedKeys().map((key) => key.name))
  } catch (err) {
    console.warn('[registerTizenRemoteKeys] getSupportedKeys() failed — Back/media remote keys will not work this session.', err)
    return
  }
  for (const name of REMOTE_KEYS_TO_REGISTER) {
    if (!supported.has(name)) continue
    try {
      inputDevice.registerKey(name)
    } catch {
      // Already registered — safe to ignore.
    }
  }
}

export function exitApp(): void {
  if (!isTizen()) return
  window.tizen!.application.getCurrentApplication().exit()
}
