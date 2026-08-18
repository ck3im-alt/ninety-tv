// One playlist entry exactly as the source (M3U/Xtream) listed it — before
// quality-variant merging. IPTV playlists commonly list the same logical
// channel multiple times, once per source quality (e.g. "TNT SPORTS 1 RAW",
// "TNT SPORTS 1 UHD", "TNT SPORTS 1 HD"). See mergeChannels.ts, which folds
// these down into one Channel with multiple selectable sources.
export interface RawChannel {
  id: string
  name: string
  logo?: string
  groupTitle?: string
  url: string
  // The source's own EPG-channel identity (M3U `tvg-id` / Xtream
  // `epg_channel_id`) — kept separate from `id` (which always has a value,
  // real or synthetic) so downstream code can tell "this entry is genuinely
  // tied to a stable EPG channel" from "it isn't". Normal 24/7 linear
  // channels are almost always EPG-mapped by the provider; synthetically
  // generated per-match/PPV entries usually aren't, since there's no
  // recurring programme behind them to map — see channelMatch.ts's PPV
  // matching, which uses this as a structural signal independent of naming.
  epgChannelId?: string
}
