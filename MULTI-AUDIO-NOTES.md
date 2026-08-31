# Multi-audio (commentary language) selection — what works, and what raw MPEG-TS still needs

Written alongside the multi-audio implementation. The motivating case is a
channel like **V Sport Ultra**, which carries Norwegian, Swedish and Danish
commentary as separate audio tracks inside one channel.

The capability lives at the `Player` layer (`src/core/player/types.ts`):
`PlayerState.audioTracks` / `activeAudioTrack`, and `Player.setAudioTrack(id)`.
`ChannelPlayerScreen` talks only to that contract, exactly as it does for
subtitles. This document records what each engine can actually deliver behind
it, because one of them cannot deliver anything — and that is a platform
finding rather than an implementation gap.

## Engine capability, verified against the installed libraries

| Engine | Enumerate | Language metadata | Switch live | Status |
| --- | --- | --- | --- | --- |
| hls.js 1.6.x (`.m3u8`) | yes | yes | yes | **implemented** |
| Native `<video>` AudioTrackList | runtime-dependent | yes | yes | **implemented, feature-detected** |
| mpegts.js 1.8.1 (`.ts`) | **no** | **no** | **no** | **not possible** — see below |

### hls.js — works

`hls.audioTracks` returns the selectable renditions of the current AUDIO
group as `MediaPlaylist[]` (`lang`, `name`, `groupId`, `id`, `default`);
`hls.audioTrack` is a **positional index into that array**, and
`AUDIO_TRACKS_UPDATED` / `AUDIO_TRACK_SWITCHED` report changes.

Two traps worth keeping in mind:

- `MediaPlaylist.id` is a counter assigned while parsing **every** media entry
  of the master playlist (subtitles included), *not* an index into
  `hls.audioTracks`. Our `AudioTrack.id` is therefore `hls:${groupId}:${id}`
  and an internal map translates it to the positional index at switch time.
  A positional id would silently select a different language after a channel
  change.
- `AUDIO_TRACKS_UPDATED` is deliberately **not** dispatched for a stream that
  never had alternate audio, which is exactly why an ordinary channel reports
  an empty list and shows no Audio control.

### Native `<video>` — feature-detected, usually absent

Chromium ships `AudioTrackList` behind a disabled-by-default flag. On desktop
Chrome and on the **Tizen 6.5 / Chromium 76** firmware this app targets,
`video.audioTracks` is simply absent. The TypeScript DOM lib declaring it does
not make it exist, so the code probes for the list *and* for a boolean
`enabled` on its entries — a list that cannot be switched is not support, and
would produce menu rows that do nothing.

### mpegts.js — genuinely cannot do this

Verified in `node_modules/mpegts.js/src/demux/ts-demuxer.ts`:

- While walking the PMT, the demuxer guards every audio stream type with
  `already_has_audio`. **The first audio elementary stream wins**; the second
  and third commentary PIDs are discarded before anything reaches MSE.
- It parses the ISO 639 language descriptor (tag `0x0A`) **only** for PGS
  subtitle streams (`pgs_langs`), never for audio — so even the first track
  has no language metadata.
- `Mpegts.Player` (`d.ts/mpegts.d.ts`) exposes no track enumeration and no
  track selection at all.

So for a raw `.ts` source the Player reports an empty list, and the OSD shows
no Audio control. That is the honest answer. Fabricating rows that cannot be
switched would be worse than offering nothing.

**This matters for the motivating case.** Ninety's Xtream path defaults to
`.ts` (`buildLiveStreamUrl` in `src/data/xtream/xtreamClient.ts` — `.m3u8`
only exists on panels that explicitly transcode to it). So a V Sport Ultra
channel coming from an Xtream panel gets multi-audio **only** if that
particular playlist entry is an HLS URL. Through mpegts.js it cannot.

## The correct platform solution for raw MPEG-TS: Samsung AVPlay

Samsung's native player can do what mpegts.js cannot, because the demuxing
happens in platform code rather than in JS:

- `webapis.avplay.getTotalTrackInfo()` → entries with `type === 'AUDIO'`
- language in each entry's `extra_info` (a JSON string)
- `webapis.avplay.setSelectTrack('AUDIO', index)` to switch during playback

This was **deliberately not implemented in this change**, and the reasons are
architectural rather than effort-based:

1. **Multiview breaks.** AVPlay supports one (on some models two) concurrent
   instances. Ninety's Multiview runs up to four panes, each with its own
   independent `Player` via `usePlayerSession`. AVPlay can therefore never be
   the universal engine here — at best it is a *full-screen-only* engine, i.e.
   a genuine two-engine architecture selected per context, not a swap.
2. **The attach contract changes.** `Player.attach(element: HTMLVideoElement)`
   assumes an in-page `<video>`. AVPlay renders into a hardware plane behind
   an `<object type="application/avplayer">`, with its own
   `open`/`setDisplayRect`/`prepareAsync`/`play` lifecycle and its own
   z-ordering rules. The OSD layering, `.video-el` styling and the Multiview
   grid all assume the current model.
3. **It cannot be verified here.** At this device's Partner tier there is no
   devtools, dlog or inspector (see the Tizen dev-setup notes). AVPlay code
   would be written blind and shipped into a beta RC unexercised — the exact
   thing a stall-watchdog-shaped scar tissue in this codebase exists because
   of.

The `Player` abstraction is already the right seam for it: nothing in
`ChannelPlayerScreen` or `PlayerSessionController` would change. The work is
scoped, but it is a hardware-verified piece of work, not a line item on a UI
ticket.

### If/when it is picked up

- Add `tizenAvPlayPlayer.ts` implementing `Player`, with all `webapis.*`
  access behind one typed adapter (extend `src/types/tizen.d.ts`), so track
  parsing/selection is unit-testable without a TV runtime.
- Select it only for `.ts` sources **on Tizen**, and only for full-screen
  playback — Multiview panes must keep the MSE player.
- `getTotalTrackInfo()`'s `extra_info` is a JSON *string* and its shape varies
  by firmware; parse defensively and fall back to `Audio N` labels
  (`buildAudioTrackLabel` already handles a missing language).

## Deliberately out of scope

No global "always prefer Norwegian" preference. Each source exposes and
selects its own default track, and a new source load clears audio state
entirely — see the failover reasoning in `playerSessionController.ts`.
Persisting a language preference is a separate feature; correctness of the
per-source behaviour comes first.
