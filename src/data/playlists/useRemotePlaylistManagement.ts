import { useEffect, useRef } from 'react'
import { fetchWithTimeout } from '../../core/net/fetchWithTimeout'
import { loadDeviceCredential } from '../deviceCredential'
import { verifyAccount } from '../xtream/xtreamClient'
import { connectPlaylistFromUrl, loadChannelsForSource } from './connectPlaylist'
import { loadPlaylistLibrary } from './playlistLibraryStore'
import type { PlaylistLibrary } from './usePlaylistLibrary'

export interface RemotePlaylistCommand {
  id: string; operation: 'add' | 'rename' | 'delete' | 'refresh'
  playlistId: string; name: string | null; url?: string
}

// Stable ids make retries safe when the TV applies a change but loses its
// acknowledgement. The library owns all live/cache mutations, as it does
// for changes made directly in TV Settings.
export async function applyRemotePlaylistCommand(command: RemotePlaylistCommand, current: () => { library: PlaylistLibrary; playback: boolean }): Promise<boolean> {
  if (current().playback) return false
  const library = current().library
  const playlist = loadPlaylistLibrary().find((item) => item.id === command.playlistId)
  if (command.operation === 'add') {
    if (playlist) return true
    if (!command.url || !command.name) throw new Error('Missing playlist details')
    const connection = await connectPlaylistFromUrl(command.url)
    if (current().playback) return false
    await current().library.addPlaylist(connection.source, connection.channels, { id: command.playlistId, name: command.name })
  } else if (command.operation === 'delete') {
    if (playlist) await library.removePlaylist(command.playlistId)
  } else {
    if (!playlist) throw new Error('Playlist no longer exists')
    if (command.operation === 'rename') {
      if (!command.name) throw new Error('Missing playlist name')
      library.renamePlaylist(command.playlistId, command.name)
    } else if (command.operation === 'refresh') {
      if (playlist.source.type === 'file') throw new Error('File needs replacing')
      const channels = await loadChannelsForSource(playlist.source)
      if (current().playback) return false
      await current().library.replaceConnection(command.playlistId, playlist.source, channels)
    } else throw new Error('Unknown playlist action')
  }
  // A storage failure must be reported as a failure to the phone, even if
  // the current TV session could temporarily show the new data.
  const stored = loadPlaylistLibrary().find((item) => item.id === command.playlistId)
  if (command.operation === 'delete' ? Boolean(stored) : !stored || (command.operation === 'rename' && stored.name !== command.name)) throw new Error('Playlist change did not persist')
  return true
}

export function useRemotePlaylistManagement(library: PlaylistLibrary, playback: boolean) {
  const current = useRef({ library, playback })
  const running = useRef(false)
  const acks = useRef<{ id: string; status: 'completed' | 'failed' }[]>([])
  useEffect(() => { current.current = { library, playback } }, [library, playback])
  useEffect(() => {
    let stopped = false
    const expiries = new Map<string, { at: number; expiresAt: string | null }>()
    async function tick() {
      const credential = loadDeviceCredential()
      const baseUrl = import.meta.env.VITE_NINETY_API_URL as string | undefined
      if (stopped || running.current || !credential || !baseUrl || current.current.library.hydration !== 'done' || document.hidden) return
      running.current = true
      try {
        const definitions = loadPlaylistLibrary()
        const playlists = await Promise.all(definitions.map(async (playlist) => {
          let expiry = expiries.get(playlist.id)
          if (playlist.source.type === 'xtream' && (!expiry || Date.now() - expiry.at > 60 * 60_000)) {
            try {
              const info = await verifyAccount(playlist.source)
              const seconds = Number(info.user_info.exp_date)
              const ms = seconds * 1000
              const expiresAt = Number.isFinite(ms) && ms > 0 && ms < 8.64e15 ? new Date(ms).toISOString() : null
              expiry = { at: Date.now(), expiresAt }
            } catch { expiry = { at: Date.now(), expiresAt: expiry?.expiresAt ?? null } }
            expiries.set(playlist.id, expiry)
          }
          return { id: playlist.id, name: playlist.name.slice(0, 80), type: playlist.source.type, channelCount: playlist.channelCount, lastSyncedAt: playlist.lastSyncedAt, expiresAt: expiry?.expiresAt ?? null }
        }))
        if (stopped || loadDeviceCredential() !== credential) return
        const sentAcks = [...acks.current]
        const response = await fetchWithTimeout(`${baseUrl}/api/device/playlists/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
          body: JSON.stringify({ playlists, acknowledgements: sentAcks }),
        })
        if (!response.ok) return
        const { command } = await response.json() as { command: RemotePlaylistCommand | null }
        acks.current = acks.current.filter((ack) => !sentAcks.some((sent) => sent.id === ack.id))
        if (!command || stopped || current.current.playback || loadDeviceCredential() !== credential) return
        try {
          if (await applyRemotePlaylistCommand(command, () => ({ library: current.current.library, playback: current.current.playback || stopped || loadDeviceCredential() !== credential }))) acks.current.push({ id: command.id, status: 'completed' })
        } catch {
          // Never send a provider exception/URL/login to the API or log it.
          acks.current.push({ id: command.id, status: 'failed' })
        }
      } catch { /* Network failures retain acknowledgements for the next tick. */ }
      finally { running.current = false }
    }
    void tick()
    const timer = setInterval(() => void tick(), 10_000)
    window.addEventListener('ninety:device-credential-changed', tick)
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('ninety:device-credential-changed', tick) }
  }, [])
}
