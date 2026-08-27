// @vitest-environment jsdom
//
// Match View focus contract.
//
// The reported bug ("the first stream doesn't look selected") was never a
// logical-focus bug — `topPickFocusKey` has always been both the container's
// preferredChildFocusKey and an explicit setFocus on the loading->ready
// transition, and OK has always played the right stream. It was a visual
// collision: `--accent` and `--border-focus` are the same green, and
// `.stream-row.top-pick` wore an accent border plus an accent glow AT REST,
// so focusing it changed almost nothing while focusing row 2 changed a lot.
//
// CSS cannot be asserted in jsdom, so these tests pin the two halves that
// can be: the logical target is right and stays right, and the two states
// are carried by DIFFERENT, independently observable class/DOM signals — so
// a future change cannot quietly re-merge "recommended" and "focused" into
// one visual channel again without breaking a test.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentFocusKey, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { EventDetailsScreen } from './EventDetailsScreen'
import { BACK_FOCUS_KEY, favoriteFocusKeyFor } from './eventDetailsFocusKeys'
import { buildEventStreamOptions, partitionStreamOptions, rankEventStreamOptions } from './buildEventStreamOptions'
import type { ChannelMatch } from '../../data/sports/channelMatch'
import type { Channel, ChannelSource } from '../../data/channel'
import type { SportEvent } from '../../data/sports/types'
import type { XtreamCredentialResolver } from '../../data/playlists/xtreamResolver'

init({ debug: false, visualDebug: false })
Element.prototype.scrollIntoView = () => {}

const { matchChannelsForEventMock } = vi.hoisted(() => ({
  matchChannelsForEventMock: vi.fn(),
}))

vi.mock('../../data/sports/channelMatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/sports/channelMatch')>()),
  matchChannelsForEvent: matchChannelsForEventMock,
}))

function match(id: string, name: string, groupTitle: string, sources: ChannelSource[]): ChannelMatch {
  const channel: Channel = { id, name, groupTitle, sources }
  return {
    channel,
    source: 'ninety',
    label: name,
    isExactMatch: true,
    identityClassification: 'CONFIRMED',
    logicalChannelId: `logical_${id}`,
  }
}

const MATCHES: ChannelMatch[] = [
  match('c1', 'TV 2 Sport 1', 'NO| Sport', [{ label: 'FHD', url: 'http://x/1' }]),
  match('c2', 'Viaplay Sport 1', 'NO| Sport', [{ label: 'HD', url: 'http://x/2' }]),
  match('c3', 'Canal+ Sport', 'NO| Sport', [{ label: 'HD', url: 'http://x/3' }]),
]

const EVENT: SportEvent = {
  id: 'evt-1',
  sportKey: 'football',
  sportLabel: 'Football',
  league: 'Eliteserien',
  leagueId: 'no_eliteserien',
  title: 'Rosenborg vs Molde',
  homeTeam: 'Rosenborg',
  awayTeam: 'Molde',
  dateTimeUtc: '2026-08-27T18:00:00Z',
  timeLabel: '20:00',
  isLive: false,
  status: 'scheduled',
}

// The match effect no longer keys on this array at all — it keys on
// `playlistGenerationId` (see H3, now fixed). Kept stable here anyway
// because that is what App.tsx passes, and because a test that depended on
// a fresh array per render would be asserting the wrong contract.
const CHANNELS: Channel[] = MATCHES.map((m) => m.channel)

// The focus key of each rendered row, in rendered order — derived through
// the same pipeline the screen uses rather than hardcoded, so a change to
// how option keys are built shows up here as a real failure, not a silent
// mismatch.
function rowFocusKeys(favoriteChannels: ReadonlySet<string> = new Set<string>()): string[] {
  const options = buildEventStreamOptions(MATCHES, favoriteChannels, {
    homeTeam: EVENT.homeTeam,
    awayTeam: EVENT.awayTeam,
    eventTitle: EVENT.title,
    dateTimeUtc: EVENT.dateTimeUtc,
  })
  const { trusted } = partitionStreamOptions(rankEventStreamOptions(options, { favoriteCountries: [], streamType: 'auto' }))
  return trusted.map((option) => option.key)
}

const XTREAM: XtreamCredentialResolver = { forChannel: () => null, forSource: () => null } as unknown as XtreamCredentialResolver

// Lets a test hold the screen in its `loading` state and release it on
// demand, so the loading -> ready transition is observable rather than
// instantaneous.
function deferredMatches() {
  let release!: (matches: ChannelMatch[]) => void
  const promise = new Promise<{ matches: ChannelMatch[]; apiHasData: boolean; apiStations: [] }>((resolve) => {
    release = (matches) => resolve({ matches, apiHasData: true, apiStations: [] })
  })
  matchChannelsForEventMock.mockReturnValue(promise)
  return {
    async ready(matches: ChannelMatch[] = MATCHES) {
      await act(async () => {
        release(matches)
        await promise
        await Promise.resolve()
      })
      await settle()
    },
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function renderScreen(overrides: Partial<{ favoriteChannels: Set<string> }> = {}) {
  const onWatch = vi.fn()
  const onToggleFavoriteChannels = vi.fn()
  const onBack = vi.fn()
  const view = render(
    <EventDetailsScreen
      event={EVENT}
      channels={CHANNELS}
      playlistGenerationId="gen-1"
      xtream={XTREAM}
      identityIndex={null}
      favoriteChannels={overrides.favoriteChannels ?? new Set<string>()}
      onToggleFavoriteChannels={onToggleFavoriteChannels}
      onWatch={onWatch}
      onBack={onBack}
      onBrowseChannels={() => {}}
    />,
  )
  const rows = () => [...view.container.querySelectorAll('.stream-row')]
  return { ...view, onWatch, onToggleFavoriteChannels, onBack, rows }
}

beforeEach(async () => {
  // norigin's service is a module singleton and cleanup() does not clear the
  // key it thinks is focused; its focusOnPresetKey option would otherwise
  // re-focus a same-keyed component the next test mounts.
  await setFocus('test-neutral-focus-key')
  matchChannelsForEventMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Match View initial focus', () => {
  it('keeps Back as the only target while matches are still loading', async () => {
    const gate = deferredMatches()
    const { container } = renderScreen()
    await settle()

    expect(container.querySelector('.stream-area-loading')).toBeTruthy()
    await act(async () => {
      await setFocus('event-details-screen')
    })
    expect(getCurrentFocusKey()).toBe(BACK_FOCUS_KEY)

    await gate.ready()
    expect(container.querySelector('.stream-area-loading')).toBeNull()
  })

  it('moves focus onto the top-ranked stream when matches become ready', async () => {
    const gate = deferredMatches()
    const { container } = renderScreen()
    await settle()
    await act(async () => {
      await setFocus('event-details-screen')
    })

    await gate.ready()

    // The focused row is the first one rendered, and it is the row marked
    // as the top pick.
    const focusedRows = container.querySelectorAll('.stream-row.focused')
    expect(focusedRows).toHaveLength(1)
    expect(focusedRows[0]).toBe(container.querySelector('.stream-row'))
    expect(focusedRows[0].className).toContain('top-pick')
  })

  it('plays the top-ranked stream on the first OK press', async () => {
    const gate = deferredMatches()
    const { onWatch } = renderScreen()
    await settle()
    await gate.ready()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 })
      await Promise.resolve()
    })

    expect(onWatch).toHaveBeenCalledTimes(1)
    expect(onWatch.mock.calls[0][0].variants[0].candidates[0].source.url).toBe('http://x/1')
  })

  // The audit's sub-frame race: a press landing in the same frame as the
  // matches can leave focus on a row that genuinely exists, and the
  // ready-transition effect must not then yank it back to row 1.
  it('does not steal focus back to the top pick if the user already moved', async () => {
    const gate = deferredMatches()
    renderScreen()
    await settle()
    await gate.ready()

    await act(async () => {
      await setFocus(rowFocusKeys()[1])
    })
    expect(getCurrentFocusKey()).toBe(rowFocusKeys()[1])
  })
})

describe('Match View recommended vs focused', () => {
  it('states the recommendation in words, not only in colour', async () => {
    const gate = deferredMatches()
    const { container } = renderScreen()
    await settle()
    await gate.ready()

    const badges = container.querySelectorAll('.stream-row-rank-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0].textContent).toBe('TOP PICK')
    // On the top pick, and nowhere else.
    expect(container.querySelector('.stream-row.top-pick')!.contains(badges[0])).toBe(true)
  })

  it('carries top-pick and focused as two independent signals', async () => {
    const gate = deferredMatches()
    const { container, rows } = renderScreen()
    await settle()
    await gate.ready()

    const [first, second] = rows()
    expect(first.className).toContain('top-pick')
    expect(first.className).toContain('focused')

    // Move focus to row 2: the top pick keeps its recommendation and loses
    // focus; row 2 gains focus and never gains the recommendation. If these
    // two ever collapse into one class again, this fails.
    await act(async () => {
      await setFocus(rowFocusKeys()[1])
    })
    await settle()

    expect(container.querySelectorAll('.stream-row.top-pick')).toHaveLength(1)
    expect(container.querySelectorAll('.stream-row.focused')).toHaveLength(1)
    expect(container.querySelector('.stream-row.top-pick')).toBe(first)
    expect(container.querySelector('.stream-row.focused')).toBe(second)
    expect(second.querySelector('.stream-row-rank-badge')).toBeNull()
  })
})

describe('Match View row <-> favourite navigation', () => {
  async function readyScreen() {
    const gate = deferredMatches()
    const view = renderScreen()
    await settle()
    await gate.ready()
    return view
  }

  it('gives every star a key derived from its own row', async () => {
    const { container } = await readyScreen()
    const firstRowKey = getCurrentFocusKey()!
    expect(container.querySelectorAll('.stream-row-favorite')).toHaveLength(MATCHES.length)

    // Right from the row lands on THAT row's star — not a neighbour's.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowRight', keyCode: 39 })
      await Promise.resolve()
    })
    await settle()
    expect(getCurrentFocusKey()).toBe(favoriteFocusKeyFor(firstRowKey))
    expect(container.querySelectorAll('.stream-row-favorite.focused')).toHaveLength(1)
    // The star is a separate control: the row itself is no longer the
    // focused play target.
    expect(container.querySelectorAll('.stream-row.focused')).toHaveLength(0)
  })

  it('returns Left from a star to its own row', async () => {
    await readyScreen()
    const rowKey = getCurrentFocusKey()!

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowRight', keyCode: 39 })
      await Promise.resolve()
    })
    await settle()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft', keyCode: 37 })
      await Promise.resolve()
    })
    await settle()

    expect(getCurrentFocusKey()).toBe(rowKey)
  })

  it('takes Up from the first row and from its star to the same place — Back', async () => {
    await readyScreen()
    const rowKey = getCurrentFocusKey()!

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowUp', keyCode: 38 })
      await Promise.resolve()
    })
    await settle()
    expect(getCurrentFocusKey()).toBe(BACK_FOCUS_KEY)

    await act(async () => {
      await setFocus(favoriteFocusKeyFor(rowKey))
    })
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowUp', keyCode: 38 })
      await Promise.resolve()
    })
    await settle()
    expect(getCurrentFocusKey()).toBe(BACK_FOCUS_KEY)
  })
})

describe('Match View focus across benign updates', () => {
  // A live-score tick hands this screen a NEW event object with the same id.
  // It must not re-enter "Finding the best streams…" and must not move focus.
  it('survives a score tick with focus and list intact', async () => {
    const gate = deferredMatches()
    const { container, rerender } = renderScreen()
    await settle()
    await gate.ready()

    const [, second] = [...container.querySelectorAll('.stream-row')]
    await act(async () => {
      await setFocus(favoriteFocusKeyFor(getCurrentFocusKey()!))
    })
    const parked = getCurrentFocusKey()

    await act(async () => {
      rerender(
        <EventDetailsScreen
          event={{ ...EVENT, status: 'live', isLive: true, homeScore: '1', awayScore: '0' }}
          channels={CHANNELS}
          playlistGenerationId="gen-1"
          xtream={XTREAM}
          identityIndex={null}
          favoriteChannels={new Set<string>()}
          onToggleFavoriteChannels={() => {}}
          onWatch={() => {}}
          onBack={() => {}}
          onBrowseChannels={() => {}}
        />,
      )
      await Promise.resolve()
    })
    await settle()

    expect(container.querySelector('.stream-area-loading')).toBeNull()
    expect(getCurrentFocusKey()).toBe(parked)
    expect(matchChannelsForEventMock).toHaveBeenCalledTimes(1)
    expect([...container.querySelectorAll('.stream-row')][1]).toBe(second)
  })

  // If the focused row genuinely disappears (a re-match returns a smaller
  // set), focus must land somewhere deterministic — never nowhere, and never
  // on an unmounted key. norigin auto-restores to the parent, which resolves
  // through the screen container's preferredChildFocusKey.
  it('falls back deterministically when the focused row disappears', async () => {
    const gate = deferredMatches()
    const { container, rerender } = renderScreen()
    await settle()
    await gate.ready()

    await act(async () => {
      await setFocus(rowFocusKeys()[2])
    })
    expect(getCurrentFocusKey()).toBe(rowFocusKeys()[2])

    // A genuinely different playlist GENERATION ID is the one thing that DOES
    // legitimately re-run matching (see H3) — a new `channels` array on its
    // own deliberately no longer does, which is what stops a background
    // refresh from resetting this screen. Here the new generation comes back
    // with the last row gone.
    const shorter = MATCHES.slice(0, 2)
    const nextGate = deferredMatches()
    await act(async () => {
      rerender(
        <EventDetailsScreen
          event={EVENT}
          channels={shorter.map((m) => m.channel)}
          playlistGenerationId="gen-2"
          xtream={XTREAM}
          identityIndex={null}
          favoriteChannels={new Set<string>()}
          onToggleFavoriteChannels={() => {}}
          onWatch={() => {}}
          onBack={() => {}}
          onBrowseChannels={() => {}}
        />,
      )
      await Promise.resolve()
    })
    await nextGate.ready(shorter)

    expect(container.querySelectorAll('.stream-row')).toHaveLength(2)
    const landed = getCurrentFocusKey()!
    // Somewhere real, on this screen, and actionable.
    expect([...container.querySelectorAll('.stream-row')].length).toBeGreaterThan(0)
    expect(landed).not.toBe(rowFocusKeys()[2])
    expect(container.querySelector('.stream-row.focused') ?? container.querySelector('.event-details-back.focused')).toBeTruthy()
  })

  // Toggling a favourite feeds the ranking score, but the list must not
  // reshuffle under the viewer mid-navigation.
  it('does not reorder the list when a favourite is toggled', async () => {
    const gate = deferredMatches()
    const { container, rerender } = renderScreen()
    await settle()
    await gate.ready()

    const before = [...container.querySelectorAll('.stream-row-name')].map((n) => n.textContent)
    await act(async () => {
      rerender(
        <EventDetailsScreen
          event={EVENT}
          channels={CHANNELS}
          playlistGenerationId="gen-1"
          xtream={XTREAM}
          identityIndex={null}
          favoriteChannels={new Set<string>(['c3'])}
          onToggleFavoriteChannels={() => {}}
          onWatch={() => {}}
          onBack={() => {}}
          onBrowseChannels={() => {}}
        />,
      )
      await Promise.resolve()
    })
    await settle()

    expect([...container.querySelectorAll('.stream-row-name')].map((n) => n.textContent)).toEqual(before)
    // ...but the star state updates immediately.
    expect(screen.getByLabelText('Remove from favorites')).toBeTruthy()
  })
})
