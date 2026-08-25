// Decides whether a just-connected playlist is a NEW playlist or the file
// an EXISTING playlist has been waiting for.
//
// A file playlist's bytes are never retained (see session.ts's
// FileSourceRecord), so if its channel cache is ever lost — a storage-quota
// failure, IndexedDB cleared out from under the app — the library entry
// survives with nothing behind it. Hydration reports it as unrecoverable and
// the app asks the user to pick the file again.
//
// Without this, "picking the file again" went through the plain add path and
// produced a SECOND library entry: the broken "movies" row stayed forever
// (re-issuing its reconnect notice on every launch) beside a working
// "movies (2)". Before multi-playlist there was only one playlist to
// replace, so re-adding simply restored it; this restores that behaviour
// without giving up on genuinely adding a second playlist.
//
// Pure and deliberately narrow — see findReconnectTarget's rule.
import type { PlaylistDefinition } from './playlistDefinition'
import type { PlaylistSourceRecord } from '../session'

// The playlist `source` should be adopted into (reusing its id, name and
// library position) rather than added alongside, or null for a genuinely new
// playlist.
//
// The rule is exact-match only: a FILE source whose file name equals that of
// a playlist currently waiting for its file back. Nothing else qualifies.
//
//   - Only file sources, because they are the only ones that can end up
//     waiting for the user; an Xtream/M3U-URL playlist re-fetches itself.
//   - Only playlists already known to be awaiting reconnection, so adding a
//     second playlist that happens to share a file name with a HEALTHY one
//     still adds.
//   - Only an exact file-name match, never "the single awaiting playlist" —
//     adopting on count alone would silently overwrite one playlist's entry
//     with a completely different file the user meant to add.
//
// Anything that doesn't match is added normally, which is the safe direction
// to be wrong in: a duplicate row is recoverable from Settings, a silently
// overwritten playlist is not.
export function findReconnectTarget(
  source: PlaylistSourceRecord,
  awaitingReconnect: readonly PlaylistDefinition[],
): PlaylistDefinition | null {
  if (source.type !== 'file') return null
  return (
    awaitingReconnect.find(
      (playlist) => playlist.source.type === 'file' && playlist.source.fileName === source.fileName,
    ) ?? null
  )
}
