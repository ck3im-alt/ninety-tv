// Realistic "dirty" IPTV/M3U channel-name corpus (task: "Close the gap
// between EPG broadcaster resolution and real IPTV stream selection",
// 2026-08-20). NOT a production alias list — these are TEST INPUTS only,
// used by scripts/evaluate-m3u-corpus.ts and m3uCorpus.test.ts to measure
// how well the existing normalizer (normalizeChannelName/matchLeadingCountry)
// and Channel Identity Resolver v2 (channelIdentityResolver.ts) handle
// real-world playlist naming noise, WITHOUT adding speculative aliases.
//
// Every case embeds its country marker directly in the channel's own
// display name (not a separate group-title) — the harder, less-covered
// path, since mergeChannels.ts already strips group-title country prefixes
// via parseCategory. `expectedLogicalChannelId: null` means this dirty name
// is deliberately NOT expected to resolve confidently against the real
// catalog as-is (either a genuine naming mismatch or a known normalizer
// gap) — those cases are diagnostic, not a bug in the corpus.
export interface M3uCorpusCase {
  market: string
  playlistName: string
  expectedLogicalChannelId: string | null
  note: string
}

export const M3U_CORPUS: M3uCorpusCase[] = [
  // ---- UK ----
  { market: 'GB', playlistName: 'UK | SKY SPORTS MAIN EVENT UHD', expectedLogicalChannelId: 'gb_sky_sports_main_event', note: 'leading 2-letter code, recognized' },
  { market: 'GB', playlistName: 'UK: Sky Sports Premier League FHD', expectedLogicalChannelId: 'gb_sky_sports_premier_league', note: 'leading code with colon separator' },
  { market: 'GB', playlistName: 'TNT SPORTS 1 UK HD', expectedLogicalChannelId: 'uk_tnt_sports_1', note: 'TRAILING country code, before quality tag' },

  // ---- Norway ----
  { market: 'NO', playlistName: 'NO | TV2 SPORT PREMIUM FHD', expectedLogicalChannelId: 'no_tv2_sport_premium', note: 'leading code, no space in TV2 brand token' },
  { market: 'NO', playlistName: 'NOR: TV 2 SPORT 1 HD', expectedLogicalChannelId: 'no_tv2_sport_1', note: '3-letter colloquial code (NOR), not ISO — leading' },
  { market: 'NO', playlistName: 'V SPORT PREMIER LEAGUE UHD', expectedLogicalChannelId: 'no_vsport_premier_league', note: 'no country marker at all' },

  // ---- Spain ----
  { market: 'ES', playlistName: 'ES | MOVISTAR LALIGA HD', expectedLogicalChannelId: 'es_movistar_laliga_tv', note: 'real rebrand: "Movistar" is the parent brand of "M+"/"LaLiga TV"' },
  { market: 'ES', playlistName: 'SPAIN: DAZN 1 FHD', expectedLogicalChannelId: 'es_dazn_1', note: 'leading full country name with colon' },
  { market: 'ES', playlistName: 'ES: LA 1', expectedLogicalChannelId: 'es_la_1', note: 'no quality tag at all' },

  // ---- Germany ----
  { market: 'DE', playlistName: 'DE | SKY SPORT BUNDESLIGA 1 HD', expectedLogicalChannelId: 'de_sky_sport_bundesliga_1', note: 'leading 2-letter code' },
  { market: 'DE', playlistName: 'GER: RTL HD', expectedLogicalChannelId: 'de_rtl', note: '3-letter colloquial code (GER), not ISO — leading' },
  { market: 'DE', playlistName: 'DAS ERSTE FHD', expectedLogicalChannelId: 'de_das_erste', note: 'no country marker, generalist FTA channel' },

  // ---- Netherlands ----
  { market: 'NL', playlistName: 'NL | ESPN 1 FHD', expectedLogicalChannelId: 'nl_espn_1', note: 'leading code' },
  { market: 'NL', playlistName: 'NL: ZIGGO SPORT 2 HD', expectedLogicalChannelId: 'nl_ziggo_sport_2', note: 'leading code with colon; numbered sibling protection matters here' },
  { market: 'NL', playlistName: 'NPO 1 NL', expectedLogicalChannelId: 'nl_npo_1', note: 'TRAILING code, no separator/quality tag' },

  // ---- USA ----
  { market: 'US', playlistName: 'US | ESPN FHD', expectedLogicalChannelId: 'us_espn', note: 'leading 2-letter code' },
  { market: 'US', playlistName: 'USA: ESPN 2 HD', expectedLogicalChannelId: 'us_espn2', note: '3-letter colloquial code (USA), not ISO — leading' },
  { market: 'US', playlistName: 'US | FOX SPORTS 1', expectedLogicalChannelId: 'us_fs1', note: 'no quality tag; matches via FS1 source_name' },
  { market: 'US', playlistName: 'USA | FS1 UHD', expectedLogicalChannelId: 'us_fs1', note: '3-letter colloquial code (USA) with pipe separator — leading' },
  { market: 'US', playlistName: 'US: TUDN FHD', expectedLogicalChannelId: 'us_tudn', note: 'leading code with colon' },
  { market: 'US', playlistName: 'USA | UNIVISION HD', expectedLogicalChannelId: 'us_univision', note: '3-letter colloquial code (USA) — leading' },
  { market: 'US', playlistName: 'CBS SPORTS NETWORK US', expectedLogicalChannelId: 'us_cbs_sports_network', note: 'TRAILING 2-letter code, no separator, no quality tag' },

  // ---- Mexico ----
  { market: 'MX', playlistName: 'MX | TUDN HD', expectedLogicalChannelId: 'mx_tudn', note: 'leading code' },
  { market: 'MX', playlistName: 'MEX: FOX SPORTS 1 FHD', expectedLogicalChannelId: 'mx_fox_sports', note: '3-letter colloquial code (MEX) — leading; numbered vs unnumbered flagship' },
  { market: 'MX', playlistName: 'MX | ESPN 2', expectedLogicalChannelId: 'mx_espn_2', note: 'no quality tag' },

  // ---- Canada ----
  { market: 'CA', playlistName: 'CA | TSN 1 HD', expectedLogicalChannelId: 'ca_tsn_1', note: 'leading code' },
  { market: 'CA', playlistName: 'CAN: SPORTSNET ONE FHD', expectedLogicalChannelId: 'ca_sportsnet_one', note: '3-letter colloquial code (CAN) — leading' },
  { market: 'CA', playlistName: 'CA | RDS 2', expectedLogicalChannelId: 'ca_rds2', note: 'catalog name "RDS2" has no space — spacing mismatch' },

  // ---- Brazil ----
  { market: 'BR', playlistName: 'BR | SPORTV 1 FHD', expectedLogicalChannelId: 'br_sportv', note: 'catalog flagship "SporTV" is unnumbered; playlist adds "1"' },
  { market: 'BR', playlistName: 'BRA: PREMIERE CLUBES HD', expectedLogicalChannelId: 'br_premiere_clubes', note: '3-letter colloquial code (BRA) — leading' },
  { market: 'BR', playlistName: 'BR | ESPN 4', expectedLogicalChannelId: 'br_espn_4', note: 'no quality tag' },

  // ---- Argentina ----
  { market: 'AR', playlistName: 'AR | TYC SPORTS FHD', expectedLogicalChannelId: 'ar_tyc_sports', note: 'matches via "Canal TyC Sports" source_name' },
  { market: 'AR', playlistName: 'ARG: ESPN 3', expectedLogicalChannelId: 'ar_espn_3', note: '3-letter colloquial code (ARG), no quality tag — leading' },
  { market: 'AR', playlistName: 'TELEFE HD ARG', expectedLogicalChannelId: 'ar_telefe', note: 'TRAILING code AFTER a mid-string quality tag (HD)' },

  // ---- Australia ----
  { market: 'AU', playlistName: 'AU | BEIN SPORTS 2 HD', expectedLogicalChannelId: 'au_bein_sports_2', note: 'leading code' },
  { market: 'AU', playlistName: 'AUS: ESPN 2 FHD', expectedLogicalChannelId: 'au_espn2', note: '3-letter colloquial code (AUS) — leading' },
  { market: 'AU', playlistName: 'SBS AU', expectedLogicalChannelId: 'au_sbs', note: 'TRAILING code, no separator, no quality tag' },

  // ---- New Zealand ----
  { market: 'NZ', playlistName: 'NZ | SKY SPORT 1 HD', expectedLogicalChannelId: 'nz_sky_sport_1', note: 'leading code; numbered sibling protection matters (9 Sky Sport N channels)' },
  { market: 'NZ', playlistName: 'NZ: SKY SPORT PREMIER LEAGUE FHD', expectedLogicalChannelId: 'nz_sky_sport_premier_league', note: 'leading code with colon' },
  { market: 'NZ', playlistName: 'TVNZ 1', expectedLogicalChannelId: 'nz_tvnz_1', note: 'no country marker at all' },
]
