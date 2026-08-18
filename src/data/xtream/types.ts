export interface XtreamCredentials {
  server: string // e.g. "https://cf.patex-2.online" (no trailing slash, no path)
  username: string
  password: string
}

export interface XtreamLiveCategory {
  category_id: string
  category_name: string
}

// Fields as returned by player_api.php action=get_live_streams. Xtream panels
// vary slightly between implementations — everything here is optional except
// what we actually rely on, so a slightly different panel doesn't hard-fail.
export interface XtreamLiveStream {
  stream_id: number
  name: string
  stream_icon?: string
  category_id?: string
  epg_channel_id?: string
}

// action=get_short_epg. Panels disagree on whether title/description are
// base64-encoded (the format historically was, some forks send plain text
// now) — decode defensively rather than trust either way, see xtreamClient.ts.
export interface XtreamEpgListing {
  id: string
  title: string
  description: string
  start: string // "YYYY-MM-DD HH:mm:ss", server-local time
  end: string
  start_timestamp: number
  stop_timestamp: number
  now_playing: 0 | 1
}

export interface XtreamAccountInfo {
  user_info: {
    auth: 0 | 1
    status: string
    exp_date?: string
    max_connections?: string
  }
  server_info: {
    url: string
    port: string
    https_port?: string
  }
}
