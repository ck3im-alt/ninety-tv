import type { RawChannel } from '../rawChannel'
import { buildLiveStreamUrl } from './xtreamClient'
import type { XtreamCredentials, XtreamLiveCategory, XtreamLiveStream } from './types'

export function liveStreamsToChannels(
  streams: XtreamLiveStream[],
  categories: XtreamLiveCategory[],
  creds: XtreamCredentials,
): RawChannel[] {
  const categoryNameById = new Map(categories.map((c) => [c.category_id, c.category_name]))
  return streams.map((stream) => ({
    id: String(stream.stream_id),
    name: stream.name,
    logo: stream.stream_icon || undefined,
    groupTitle: stream.category_id ? categoryNameById.get(stream.category_id) : undefined,
    url: buildLiveStreamUrl(creds, stream.stream_id),
    epgChannelId: stream.epg_channel_id || undefined,
  }))
}
