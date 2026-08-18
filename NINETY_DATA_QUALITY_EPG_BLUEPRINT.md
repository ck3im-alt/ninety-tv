# NINETY — DATA QUALITY & EPG RESOLUTION BLUEPRINT

**Document type:** Engineering blueprint / source-of-truth specification  
**Primary goal:** Maximize correctness of sports-event → TV-channel → user-stream resolution  
**Scope:** Data acquisition, EPG ingestion, normalization, entity resolution, event matching, logical channels, local playlist matching, confidence, fallback, observability, testing, rollout, AI-development rules  
**Out of scope:** UI/visual design except where a UI-independent data contract is required  
**Status:** Architecture baseline  
**Design principle:** Prefer deterministic IDs and reusable open-source components. Use fuzzy/probabilistic logic only when stronger signals are unavailable. Never trade correctness for headline match-rate.

---

# 1. Executive summary

Ninety must answer one question extremely reliably:

> “For this real sporting event, which actual linear TV channels are showing it, and which matching stream does this user have locally?”

The sports-data API is **not** sufficient as the final broadcaster source because its broadcaster field may return streaming services such as Viaplay, TV 2 Play, ESPN+, DAZN, etc. These are useful hints but are not equivalent to an actual linear channel such as `V Sport Premier League`, `TV 2 Sport Premium`, `Sky Sports Premier League`, or `USA Network`.

The architecture shall therefore separate three domains:

1. **Sports truth** — what event is happening, participants, competition, kickoff, status.
2. **Broadcast truth** — what EPG programmes exist on which real linear channels around the event time.
3. **User availability** — which of those logical channels exist in the user's private M3U/Xtream source and which local stream is best.

The final pipeline is:

```text
SPORTS PROVIDER
    ↓
CANONICAL EVENT
    ↓
EPG PROGRAMME DISCOVERY
    ↓
EVENT ↔ PROGRAMME RESOLUTION
    ↓
LOGICAL BROADCAST CHANNEL(S)
    ↓
NINETY API
    ↓
USER DEVICE
    ↓
LOCAL M3U/XTREAM ↔ LOGICAL CHANNEL
    ↓
LOCAL STREAM GROUPING / RANKING
    ↓
PLAYBACK
```

The central design rule is:

> **Cloud resolves event → logical TV channel. Client resolves logical TV channel → user's private stream.**

The user's raw M3U/Xtream credentials and stream URLs should remain local to the user's device by default.

---

# 2. What Ninety should reuse instead of rebuilding

The coding agent must treat existing open-source software as reusable infrastructure and reference implementations, not as inspiration to recreate equivalent systems from scratch.

## 2.1 Dispatcharr

Use as a reference and, during prototyping, potentially as a self-hosted service for:

- M3U / Xtream ingestion
- XMLTV / EPG ingestion
- EPG auto-matching
- channel management
- multiple streams per channel
- stream failover
- plugin/integration concepts
- EPG generation/output

Verified repository capability includes EPG matching/generation, M3U and Xtream support, stream failover and plugin extension.

**Important licensing note:** Dispatcharr is AGPL-3.0.  
Do not copy Dispatcharr source code into proprietary Ninety code without an explicit license-compatibility decision. Prefer:
- running Dispatcharr as a separate service for prototyping, or
- using its architecture/behaviour as reference, or
- implementing interoperability through a documented API/interface.

Source:
- https://github.com/Dispatcharr/Dispatcharr

## 2.2 Teamarr

Use as the closest reference implementation for sports-specific matching.

Teamarr explicitly supports:
- event-based sports EPG workflows
- aliases
- fuzzy matching
- configurable regex extractors
- sports-event discovery
- Dispatcharr integration
- multiple sports/providers

Teamarr is especially valuable for understanding how inconsistent sports stream/program names can be mapped to canonical sports events.

Critical limitation from Teamarr documentation:
- it is strongest when event identity appears in stream names;
- it explicitly does not solve ordinary 24/7 linear channels where the event identity lives only in EPG metadata.

That limitation is precisely where Ninety's own central resolver must add value.

Source:
- https://github.com/Pharaoh-Labs/teamarr
- https://pharaoh-labs-teamarr.mintlify.app/

**License handling:** coding agent must inspect the repository's current license before copying any source.

## 2.3 iptv-org/epg

Use as an EPG acquisition toolkit and source catalogue.

Useful capabilities:
- downloads EPG for thousands of channels from hundreds of sources
- supports custom channel lists
- supports site-specific guide generation
- supports Docker
- configurable schedule
- XMLTV output
- optional JSON output
- source/channel database integration

The repository uses the Unlicense for its code, but the coding agent must still distinguish:
- the tool's source-code license
- the terms / rights associated with upstream TV-guide websites and guide data.

Source:
- https://github.com/iptv-org/epg

## 2.4 Tuliprox

Use mainly as an architectural and implementation reference for:
- multiple input sources
- mappings
- regex transformations
- accent-independent matching
- Unicode normalization
- provider aliases
- probing
- metadata resolution
- source priority
- failover
- large-list processing

Tuliprox is MIT licensed at the time this blueprint was written.

Source:
- https://github.com/euzu/tuliprox

## 2.5 Dispatcharr EPG Janitor / similar EPG matching extensions

Research before implementing Ninety channel-name matching.

Focus on:
- multi-stage fuzzy pipelines
- alias application
- normalization order
- rejection logic
- thresholds
- ambiguity handling
- EPG source priority

Do not blindly copy scoring values. Reproduce concepts only after test data demonstrates they improve Ninety's target use cases.

---

# 3. Fundamental architectural split

## 3.1 Ninety Cloud is responsible for

- sports provider ingestion
- canonical sporting events
- teams / players / competitions / aliases
- logical TV-channel registry
- EPG source management
- EPG fetching
- EPG parsing
- EPG normalization
- EPG programme indexing
- event ↔ EPG-programme matching
- event ↔ logical-channel relationships
- confidence calculation
- source reliability
- unmatched / ambiguous cases
- reprocessing on changed EPG data
- global alias candidates and validated aliases
- public, non-secret channel metadata
- API consumed by clients

## 3.2 User device is responsible for

- user's M3U URL
- user's Xtream endpoint / username / password
- raw stream URLs
- playlist parsing
- local playlist-channel normalization
- local playlist-channel → Ninety logical-channel matching
- local grouping of duplicate UHD/FHD/HD sources
- local stream probing
- local historical stream health
- local stream selection
- playback

## 3.3 Hybrid data

Safe data may move from device to cloud only if explicitly designed:

Possible safe telemetry:
- normalized unknown channel name
- local mapping confidence
- logical channel ID chosen
- quality tag such as UHD/FHD/HD
- aggregate success/failure statistics

Never upload by default:
- raw M3U URL
- username/password
- stream URL
- provider authentication tokens
- full private playlist
- secrets embedded in URL paths/query strings

---

# 4. Product-quality target

The resolver must optimize for **precision before recall**.

Preferred outcome:

```text
94% correctly resolved
6% unknown
0% incorrect
```

over:

```text
99% resolved
3% incorrect
```

A wrong automatic channel is materially worse than an unresolved channel.

## 4.1 Primary KPIs

Track at least:

```text
event_resolution_precision
event_resolution_recall
incorrect_auto_match_rate
unknown_rate
ambiguous_rate
channel_mapping_precision
epg_source_coverage
programme_freshness
source_failure_rate
mean_resolution_latency
p95_resolution_latency
```

## 4.2 Target thresholds for first production release

Recommended initial gates:

- `incorrect_auto_match_rate < 0.5%`
- `confirmed precision >= 99.5%`
- `probable precision >= 97%`
- `EPG freshness <= 6h` for primary sport channels
- `today event channel coverage >= 95%` for supported competitions/markets
- no automatic result if confidence is below configured threshold
- no automatic result when top candidates are materially ambiguous

---

# 5. Canonical data model

Names must not be identities.

Every meaningful entity shall have a Ninety-owned stable ID.

---

# 6. Database schema — core entities

The exact database technology can change. PostgreSQL is preferred for the central service. SQLite may be used during prototype/local development.

## 6.1 `sports`

```sql
CREATE TABLE sports (
    id                  TEXT PRIMARY KEY,
    canonical_name      TEXT NOT NULL UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Examples:
- `football`
- `basketball`
- `ice_hockey`
- `tennis`
- `motorsport`
- `golf`

## 6.2 `teams`

```sql
CREATE TABLE teams (
    id                  TEXT PRIMARY KEY,
    sport_id            TEXT NOT NULL REFERENCES sports(id),
    canonical_name      TEXT NOT NULL,
    normalized_name     TEXT NOT NULL,
    country_code        TEXT,
    gender              TEXT,
    age_group           TEXT,
    reserve_type        TEXT,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_teams_normalized_name
ON teams(sport_id, normalized_name);
```

Example:

```text
id: football_eng_manchester_united
canonical_name: Manchester United
normalized_name: manchester united
country_code: GB
gender: male
age_group: senior
```

## 6.3 `team_external_ids`

```sql
CREATE TABLE team_external_ids (
    team_id             TEXT NOT NULL REFERENCES teams(id),
    provider            TEXT NOT NULL,
    external_id         TEXT NOT NULL,
    PRIMARY KEY (provider, external_id)
);
```

Example providers:
- `sportmonks`
- `thesportsdb`
- `espn`
- `api_sports`

## 6.4 `team_aliases`

```sql
CREATE TABLE team_aliases (
    id                  BIGSERIAL PRIMARY KEY,
    team_id             TEXT NOT NULL REFERENCES teams(id),
    alias               TEXT NOT NULL,
    normalized_alias    TEXT NOT NULL,
    language_code       TEXT,
    country_code        TEXT,
    source              TEXT NOT NULL,
    confidence          NUMERIC(5,4) NOT NULL,
    observations        INTEGER NOT NULL DEFAULT 1,
    status              TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_team_alias_scope
ON team_aliases(team_id, normalized_alias, COALESCE(language_code,''), COALESCE(country_code,''));
```

Allowed status:
- `seed`
- `candidate`
- `accepted`
- `rejected`
- `deprecated`

Examples for Manchester United:
- `Man Utd`
- `Man United`
- `Manchester Utd`
- `MUFC`

Aliases must be contextual. Do not globally map `United` to Manchester United.

## 6.5 `competitions`

```sql
CREATE TABLE competitions (
    id                  TEXT PRIMARY KEY,
    sport_id            TEXT NOT NULL REFERENCES sports(id),
    canonical_name      TEXT NOT NULL,
    normalized_name     TEXT NOT NULL,
    country_code        TEXT,
    governing_body      TEXT,
    competition_type    TEXT,
    active              BOOLEAN NOT NULL DEFAULT TRUE
);
```

## 6.6 `competition_aliases`

Same general structure as team aliases.

Examples:
- `Premier League`
- `EPL`
- `English Premier League`
- `PL` — only with strict context; too ambiguous globally.

## 6.7 `events`

```sql
CREATE TABLE events (
    id                  TEXT PRIMARY KEY,
    sport_id            TEXT NOT NULL REFERENCES sports(id),
    competition_id      TEXT REFERENCES competitions(id),
    start_time_utc      TIMESTAMPTZ NOT NULL,
    expected_end_utc    TIMESTAMPTZ,
    status              TEXT,
    round_code          TEXT,
    venue_id            TEXT,
    country_code        TEXT,
    source_priority     INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_time
ON events(sport_id, start_time_utc);
```

## 6.8 `event_participants`

```sql
CREATE TABLE event_participants (
    event_id            TEXT NOT NULL REFERENCES events(id),
    participant_type    TEXT NOT NULL,
    participant_id      TEXT NOT NULL,
    side                TEXT,
    seed                INTEGER,
    PRIMARY KEY (event_id, participant_type, participant_id)
);
```

For football:
- participant_type = `team`
- side = `home` / `away`

For tennis:
- participant_type = `player`

## 6.9 `event_external_ids`

```sql
CREATE TABLE event_external_ids (
    event_id            TEXT NOT NULL REFERENCES events(id),
    provider            TEXT NOT NULL,
    external_id         TEXT NOT NULL,
    PRIMARY KEY (provider, external_id)
);
```

---

# 7. Broadcast / EPG data model

## 7.1 `epg_sources`

```sql
CREATE TABLE epg_sources (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    source_type             TEXT NOT NULL,
    country_code            TEXT,
    language_code           TEXT,
    priority                INTEGER NOT NULL DEFAULT 50,
    reliability_score       NUMERIC(5,4) NOT NULL DEFAULT 0.5000,
    enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
    fetch_url               TEXT,
    schedule                TEXT,
    last_fetch_started_at   TIMESTAMPTZ,
    last_fetch_success_at   TIMESTAMPTZ,
    last_fetch_failure_at   TIMESTAMPTZ,
    last_error              TEXT,
    programme_coverage      NUMERIC(5,4),
    channel_coverage        NUMERIC(5,4),
    stale_after_minutes     INTEGER NOT NULL DEFAULT 360
);
```

Source types:
- `xmltv_url`
- `iptv_org_generated`
- `provider_xmltv`
- `schedules_direct`
- `custom_adapter`

## 7.2 `epg_channels`

```sql
CREATE TABLE epg_channels (
    id                  BIGSERIAL PRIMARY KEY,
    epg_source_id       TEXT NOT NULL REFERENCES epg_sources(id),
    source_channel_id   TEXT NOT NULL,
    display_name        TEXT NOT NULL,
    normalized_name     TEXT NOT NULL,
    country_code        TEXT,
    language_code       TEXT,
    logo_url            TEXT,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(epg_source_id, source_channel_id)
);
```

## 7.3 `epg_programmes`

```sql
CREATE TABLE epg_programmes (
    id                      BIGSERIAL PRIMARY KEY,
    epg_channel_id          BIGINT NOT NULL REFERENCES epg_channels(id),
    start_time_utc          TIMESTAMPTZ NOT NULL,
    end_time_utc            TIMESTAMPTZ NOT NULL,
    title                   TEXT NOT NULL,
    normalized_title        TEXT,
    subtitle                TEXT,
    description             TEXT,
    categories              JSONB,
    live_flag               BOOLEAN,
    new_flag                BOOLEAN,
    raw_hash                TEXT NOT NULL,
    source_updated_at       TIMESTAMPTZ,
    ingested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_epg_programmes_channel_time
ON epg_programmes(epg_channel_id, start_time_utc, end_time_utc);

CREATE INDEX idx_epg_programmes_start_time
ON epg_programmes(start_time_utc);
```

`raw_hash` prevents unnecessary rewrites and enables change detection.

---

# 8. Logical-channel registry

The cloud must expose stable channel identities independent of EPG source and user playlist naming.

## 8.1 `logical_channels`

```sql
CREATE TABLE logical_channels (
    id                  TEXT PRIMARY KEY,
    canonical_name      TEXT NOT NULL,
    normalized_name     TEXT NOT NULL,
    country_code        TEXT,
    language_code       TEXT,
    network_name        TEXT,
    channel_number      TEXT,
    channel_variant     TEXT,
    broadcast_type      TEXT NOT NULL DEFAULT 'LINEAR',
    active              BOOLEAN NOT NULL DEFAULT TRUE
);
```

Examples:

```text
no_vsport_premier_league
uk_sky_sports_premier_league
us_usa_network
```

`broadcast_type`:
- `LINEAR`
- `STREAMING`
- `BOTH`
- `UNKNOWN`

## 8.2 `logical_channel_aliases`

```sql
CREATE TABLE logical_channel_aliases (
    id                      BIGSERIAL PRIMARY KEY,
    logical_channel_id      TEXT NOT NULL REFERENCES logical_channels(id),
    alias                   TEXT NOT NULL,
    normalized_alias        TEXT NOT NULL,
    country_code            TEXT,
    source                  TEXT NOT NULL,
    confidence              NUMERIC(5,4) NOT NULL,
    observations            INTEGER NOT NULL DEFAULT 1,
    status                  TEXT NOT NULL
);
```

## 8.3 `epg_channel_mappings`

```sql
CREATE TABLE epg_channel_mappings (
    epg_channel_id          BIGINT NOT NULL REFERENCES epg_channels(id),
    logical_channel_id      TEXT NOT NULL REFERENCES logical_channels(id),
    confidence              NUMERIC(5,4) NOT NULL,
    method                  TEXT NOT NULL,
    verified                BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(epg_channel_id, logical_channel_id)
);
```

Preferred methods:
- `source_id_exact`
- `known_external_id`
- `accepted_alias`
- `normalized_exact`
- `fuzzy`
- `manual_verified`

---

# 9. Event-to-channel match storage

## 9.1 `event_channel_matches`

```sql
CREATE TABLE event_channel_matches (
    id                      BIGSERIAL PRIMARY KEY,
    event_id                TEXT NOT NULL REFERENCES events(id),
    logical_channel_id      TEXT NOT NULL REFERENCES logical_channels(id),
    epg_programme_id        BIGINT REFERENCES epg_programmes(id),
    epg_source_id           TEXT REFERENCES epg_sources(id),
    score                   NUMERIC(6,3) NOT NULL,
    confidence              NUMERIC(5,4) NOT NULL,
    classification          TEXT NOT NULL,
    method                  TEXT NOT NULL,
    explanation             JSONB NOT NULL,
    first_matched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_verified_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at              TIMESTAMPTZ,
    active                  BOOLEAN NOT NULL DEFAULT TRUE
);
```

Classifications:
- `CONFIRMED`
- `PROBABLE`
- `AMBIGUOUS`
- `UNKNOWN`
- `REJECTED`

The `explanation` field is mandatory.

Example:

```json
{
  "participant_1": {"input":"Man Utd","resolved":"football_eng_manchester_united","score":30},
  "participant_2": {"input":"Arsenal","resolved":"football_eng_arsenal","score":30},
  "time_delta_minutes": -5,
  "time_score": 20,
  "competition_score": 10,
  "source_score": 5,
  "broadcaster_hint_score": 2,
  "penalties": [],
  "runner_up_score": 69,
  "margin": 28
}
```

---

# 10. Sports-provider ingestion

Sports provider data supplies event truth, not channel truth.

## 10.1 Required event fields

Minimum:

```text
external event ID
sport
competition
participants
kickoff timestamp
status
season
country if available
venue if available
round/stage if available
scores/status for live events
```

Optional:
- artwork
- broadcaster hints
- round labels
- referee
- venue details

## 10.2 Provider abstraction

Implement a provider interface:

```python
class SportsProvider:
    def fetch_events(self, start_utc, end_utc, sports=None, competitions=None):
        ...

    def fetch_event(self, external_id):
        ...

    def fetch_team(self, external_team_id):
        ...
```

Do not let provider-specific naming leak into the resolver core.

## 10.3 Canonicalization process

For every provider event:

```text
provider event
↓
resolve competition
↓
resolve participants
↓
normalize timestamp to UTC
↓
find/create canonical event
↓
store provider external ID
↓
store provider broadcaster hint separately
```

Broadcaster hints must never overwrite EPG-derived logical broadcast matches.

---

# 11. EPG acquisition

## 11.1 Source strategy

Use multiple sources with explicit priorities.

Start narrow:
- Norway
- relevant sports channels
- competitions in Ninety V1

Do not ingest global EPG data before the resolver is proven.

## 11.2 Recommended acquisition order

1. high-quality local/provider XMLTV where available
2. iptv-org-generated guides from selected source sites
3. secondary public EPG source
4. paid EPG source only where needed
5. user/provider EPG only as local client fallback if later required

## 11.3 iptv-org use

Use custom channel lists rather than scraping all channels.

Generate only selected sports channels.

Example deployment concept:

```text
/services/epg-grabber
    channels/no.xml
    channels/uk.xml
    channels/us.xml
```

Run on a schedule.

A guide refresh must be atomic:
1. fetch into temporary file
2. validate XML
3. validate minimum channel/programme count
4. reject obviously empty/corrupt update
5. parse
6. transactionally update changed programmes
7. only mark fetch successful after ingestion completes

## 11.4 Refresh frequency

Default starting point:

```text
>24h before event        every 12h
6–24h before event       every 3h
1–6h before event        every 1h
<1h before event         every 15–30 min where source permits
live event               every 30 min or source-appropriate
```

EPG source fetching may have rate limits; do not violate upstream constraints.

---

# 12. EPG parsing

Use a mature XML parser.

Do not implement XML parsing manually.

## 12.1 Preserve fields

Preserve:
- channel ID
- display name
- programme title
- subtitle
- description
- categories
- start
- stop
- live
- new
- source identifiers
- language tags where available
- logo data where useful

Do not throw away description/category metadata. It can rescue difficult matches.

## 12.2 Time handling

Convert all times to UTC internally.

Retain original timezone/offset if useful for debugging.

Tests must cover:
- CET/CEST
- DST transition
- UTC feeds
- local-time feeds
- invalid/absent timezone
- event crossing midnight

---

# 13. Normalization architecture

Do not use one generic normalization function.

Required functions:

```text
normalize_team_name()
normalize_player_name()
normalize_competition_name()
normalize_programme_title()
normalize_channel_name()
normalize_playlist_channel_name()
```

All normalizers must be:
- deterministic
- unit-tested
- reversible only through preservation of original values
- versioned

Store both:
- original
- normalized

---

# 14. Team-name normalization

Example:

```text
"Manchester United FC"
→ "manchester united"
```

Potential operations:
- Unicode NFKD/NFKC as justified by implementation
- lowercase
- normalize whitespace
- punctuation normalization
- remove trailing organization suffixes only from known-safe list:
  - FC
  - AFC
  - CF
  - FK
  - SK
  - etc.
- never remove identity-bearing tokens
- accent-insensitive comparison may be an additional representation, not destructive storage

Do not infer:
- `United` → Manchester United
- `City` → Manchester City

---

# 15. Programme-title normalization

Programme titles may be more aggressively normalized.

Input:

```text
LIVE: Premier League — Man Utd v Arsenal [UHD]
```

Derived forms:

```text
original:
LIVE: Premier League — Man Utd v Arsenal [UHD]

normalized:
live premier league man utd v arsenal uhd

metadata-stripped:
premier league man utd v arsenal

matchup candidate:
man utd <VS> arsenal
```

Recognize structural versus markers by language:

```text
vs
vs.
v
v.
versus
mot
gegen
contre
-
–
—
@
```

Important:
- hyphen cannot always be assumed to mean versus
- `@` often means away-at-home in US sports
- parse patterns sport-by-sport

---

# 16. Channel-name normalization

Channel normalization must be conservative.

Example:

```text
NO | V SPORT PREMIER LEAGUE FHD
→ country_hint=NO
→ quality=FHD
→ base_name="V SPORT PREMIER LEAGUE"
→ normalized="v sport premier league"
```

Remove only recognized non-identity metadata:
- country prefix
- UHD
- FHD
- HD
- SD
- 4K
- HEVC
- H265
- 50FPS
- backup markers
- provider prefix if proven non-identity

Never collapse:
- ESPN vs ESPN2
- V Sport 1 vs V Sport 2
- Sky Sports Main Event vs Sky Sports Premier League
- regional variants
- +1 / time-shift variants
- East vs West feeds

Parse identity and quality separately.

---

# 17. Event candidate generation

Never fuzzy-match an event against every programme in the database.

First reduce the candidate set.

For football example:

```text
event kickoff: 20:00
programme candidate start: approximately 19:30–20:30
programme candidate end: must plausibly overlap event
```

Wider search may be used for studio/pre-game programmes but with lower confidence.

Candidate filters:
1. source enabled
2. source not stale
3. EPG channel active
4. programme overlaps event window
5. country/market filter if applicable
6. sports/category hints if available
7. title/description has at least one relevant participant or competition token when possible

---

# 18. Football resolver

V1 should optimize heavily for football.

## 18.1 Parse matchup first

Try to extract:

```text
[left participant] <VS> [right participant]
```

Examples:

```text
Man Utd v Arsenal
Man Utd - Arsenal
Manchester United vs Arsenal
Arsenal v Man United
```

Home/away order is a weak signal, not a hard requirement.

## 18.2 Participant matching order

For each participant candidate:

1. provider/external ID if available
2. exact canonical name
3. exact accepted alias
4. normalized exact
5. abbreviation/known-token rules
6. fuzzy match
7. unresolved

Fuzzy must never be first.

---

# 19. Team resolver pseudocode

```python
def resolve_team(raw_name, context):
    raw = raw_name.strip()
    normalized = normalize_team_name(raw)

    # 1. canonical exact
    exact = teams.lookup_normalized(
        sport=context.sport,
        normalized_name=normalized,
        country=context.country_hint
    )
    if exact.is_unique:
        return Match(exact.team, 1.0, "canonical_exact")

    # 2. accepted alias exact
    alias = team_aliases.lookup(
        normalized_alias=normalized,
        sport=context.sport,
        country=context.country_hint,
        statuses=["seed", "accepted"]
    )
    if alias.is_unique:
        return Match(alias.team, alias.confidence, "accepted_alias")

    # 3. context-restricted abbreviation rules
    rule_match = abbreviation_resolver.resolve(normalized, context)
    if rule_match.is_confident:
        return rule_match

    # 4. fuzzy candidates
    candidates = team_search.candidates(
        normalized,
        sport=context.sport,
        competition=context.competition,
        country=context.country_hint
    )

    # 5. conflict-aware ranking
    ranked = rank_team_candidates(normalized, candidates, context)

    if ranked.top.confidence < TEAM_FUZZY_MIN:
        return Unresolved()

    if ranked.margin < TEAM_MIN_MARGIN:
        return Ambiguous(ranked.top, ranked.second)

    return ranked.top
```

---

# 20. Why plain Levenshtein is insufficient

Example:

```text
Manchester City
Manchester United
```

They have high textual overlap but represent different teams.

Similarity functions may therefore be used only as features.

Recommended feature categories:
- exact normalized equality
- token-set overlap
- significant-token conflict
- known alias
- country
- competition membership
- opponent evidence
- time evidence
- historical verified aliases

Identity token conflict such as `city` vs `united` must materially reduce confidence.

---

# 21. Event score — initial football model

Do not hardcode permanently; version this configuration.

Initial illustrative weighting:

```text
participant A exact/accepted alias       +30
participant B exact/accepted alias       +30

start delta 0–5 min                      +20
start delta 6–15 min                     +15
start delta 16–30 min                     +8
start delta 31–60 min                     +2

competition exact                        +10
competition accepted alias                +7

source reliability                        +0..5
sports category/live metadata              +0..3
broadcaster network hint                   +0..2
```

Potential maximum ≈100.

---

# 22. Negative scores / hard rejection

Positive matching without conflict penalties is unsafe.

Recommended penalties:

```text
known wrong second participant            -50
known participant variant mismatch         -60
wrong sport                               HARD REJECT
women/men mismatch                        -60
senior/U21 mismatch                       -60
start delta > 90 min                      -40 or reject
explicit wrong competition                -20
source stale beyond hard threshold        reject
programme ended before event starts       reject unless replay/catch-up context
```

Examples requiring rejection:
- Manchester City vs Liverpool when target is Manchester United vs Liverpool
- Manchester United Women when target is men's team
- Manchester United U21 when target is senior team

---

# 23. Unordered participant matching

Broadcast listings may reverse home/away.

Canonical event:

```text
Manchester United vs Liverpool
```

EPG:

```text
Liverpool v Manchester United
```

Should still match.

Use set-equivalence as the main participant test.

Home/away order can add a very small bonus only when consistent.

---

# 24. Competition matching

Competition is a supporting signal.

Do not require it because EPG may omit competition.

Useful examples:

```text
Premier League
English Premier League
EPL
```

Competition conflict matters when explicit.

Example:

```text
target: FA Cup
EPG: Premier League: same teams
```

This should lose confidence or reject depending on timing/context.

---

# 25. Time matching

Time is one of the strongest independent signals.

Football EPG programme starts may be:
- at kickoff
- 5 minutes before
- 15 minutes before
- 30–60 minutes before for studio coverage

Use separate concepts:
- `programme_start_delta`
- `programme_overlap_with_event`
- `expected_live_window`

Do not require exact start time.

Recommended event duration defaults must be sport-specific and configurable.

Examples:
- football: 135 min operational window
- basketball: configurable longer live window
- tennis: high variance; time weighting must be weaker
- F1: session-specific
- golf: long blocks

---

# 26. Confidence classification

Do not return a boolean match only.

Use:

```text
CONFIRMED
PROBABLE
AMBIGUOUS
UNKNOWN
REJECTED
```

Initial policy example:

```text
CONFIRMED:
score >= 90
AND no hard conflicts
AND participant evidence strong

PROBABLE:
score >= 80
AND top-vs-second margin >= 10
AND no hard conflicts

AMBIGUOUS:
strong candidates exist
BUT margin < 10
OR participant resolution ambiguous

UNKNOWN:
insufficient evidence

REJECTED:
explicit contradictory evidence
```

Thresholds must be calibrated from test data.

---

# 27. Runner-up margin

The absolute score is insufficient.

Store:
- top score
- second score
- margin

Examples:

```text
97 vs 71 → safe
88 vs 86 → ambiguous
```

Even if `88` normally qualifies as probable, a 2-point margin should block auto-selection.

---

# 28. Multiple valid broadcasters

Do not assume only one channel can show an event.

An event may correctly map to:

```text
V Sport Premier League NO
Sky Sports Premier League UK
USA Network US
```

Each is an independent `event_channel_match`.

Within the same market, multiple channels may also be valid:
- main event simulcast
- dedicated competition channel
- UHD simulcast

Store all valid channels with region/market.

---

# 29. Broadcaster API usage

Sports-provider broadcaster data becomes a weak hint.

Example:

```text
provider broadcaster: Viaplay
EPG channel: V Sport Premier League
logical channel network: Viaplay Group
```

This may add a small score.

Never do:

```text
Viaplay → V Sport Premier League
```

as a deterministic mapping.

Because an event can be:
- streaming-only
- on another V Sport channel
- on multiple channels

---

# 30. Streaming-only detection

Maintain broadcaster entities separately from logical linear channels if required.

Example:

```text
Broadcaster:
Viaplay

Type:
STREAMING
```

If the sports API says Viaplay and no high-confidence linear EPG match exists:

```text
broadcast_type = STREAMING
linear_channels = []
```

Do not invent a linearly mapped channel.

---

# 31. Multi-source EPG strategy

## 31.1 Source priority

Each EPG source gets:
- priority
- reliability score
- country
- language
- freshness
- historical accuracy
- programme coverage

Example:

```text
local premium/provider guide      priority 100
high-quality local guide           priority 90
iptv-org generated local guide     priority 80
generic international guide        priority 60
```

## 31.2 Do not merge blindly

If two sources disagree:

```text
Source A:
19:55 Man Utd v Arsenal

Source B:
19:30 Premier League Live
```

Source A is better for event resolution.

Source B may still be useful as fallback.

Keep source identity attached to every programme.

---

# 32. Source reliability scoring

Update reliability based on observable metrics.

Possible factors:

```text
fetch success rate
freshness
programme completeness
verified event accuracy
channel ID stability
programme-title specificity
time accuracy
```

Do not automatically punish a source just because a programme is generic; measure across samples.

---

# 33. EPG change detection

EPG data changes close to kickoff.

Use `raw_hash` on programmes.

On refresh:
1. compare incoming programme hash
2. insert new programmes
3. update changed programmes
4. mark removed programmes if necessary
5. identify affected event windows
6. invalidate only affected event matches
7. rerun resolver for affected events

Do not rebuild all events after every guide refresh.

---

# 34. Match scheduling / precomputation

Resolve events before the client asks.

Suggested schedule per event:

```text
T-24h
T-6h
T-2h
T-30m
optional T-10m
T+30m if needed
```

Additionally rerun on relevant EPG changes.

The client should normally receive already-resolved results.

---

# 35. Logical-channel matching from EPG

EPG channels must be mapped to Ninety logical channels.

Priority order:

1. known stable external/source channel ID
2. manually verified mapping
3. accepted alias
4. normalized exact
5. fuzzy candidate with strict threshold
6. unknown

Store mapping method and confidence.

Never overwrite a verified mapping with fuzzy logic.

---

# 36. Client-side playlist architecture

User playlist remains private/local.

Recommended local model:

```text
playlist_source
playlist_channel
logical_channel_mapping
stream_source
stream_health
```

## 36.1 Local playlist entry

Store:

```json
{
  "local_id": "ch_872",
  "display_name": "NO | V SPORT PREMIER LEAGUE UHD",
  "tvg_id": "VSportPremierLeague.no",
  "group_title": "NO SPORTS",
  "logo": "...",
  "stream_url": "PRIVATE",
  "parsed": {
    "country": "NO",
    "base_name": "V SPORT PREMIER LEAGUE",
    "quality": "UHD"
  }
}
```

---

# 37. Client-side channel mapping order

```text
1. tvg-id exact
2. known logical external ID
3. accepted logical-channel alias
4. normalized exact channel name
5. conservative fuzzy match
6. unmapped
```

If `tvg-id` matches a known stable mapping, do not override it because a fuzzy channel name looks closer.

---

# 38. Client-side duplicate grouping

Input:

```text
NO | V SPORT PREMIER LEAGUE UHD
NO | V SPORT PREMIER LEAGUE FHD
NO | V SPORT PREMIER LEAGUE HD
NO | V SPORT PREMIER LEAGUE BACKUP
```

Output:

```text
logical_channel_id:
no_vsport_premier_league

sources:
- UHD
- FHD
- HD
- backup
```

Retain each original stream independently.

---

# 39. Stream quality extraction

Recognize:
- 2160p
- 4K
- UHD
- 1080p
- FHD
- HD
- 720p
- SD
- HEVC/H265
- H264
- 50fps/60fps if present

Do not trust filename/name tags as absolute truth.

They are hints until locally probed.

---

# 40. Local probing

Probing should happen on the user's device/network where practical.

Reason:
- provider may block data-center IPs
- geo restrictions differ
- provider connection limits differ
- server-side reachability does not prove user-side reachability

Probe conservatively to avoid exhausting provider connection limits.

Capture:
- reachable
- startup latency
- measured resolution
- codec
- frame rate if available
- recent failures
- last success
- buffering/failure history

---

# 41. Local stream ranking

Initial ranking policy:

```text
1. reachable
2. user/device codec compatibility
3. verified resolution
4. recent success
5. startup latency
6. historical stability
7. advertised quality
```

Do not pick UHD merely because the name says UHD if it repeatedly fails.

---

# 42. Local failover

If selected stream fails during startup:

```text
UHD → FHD → HD → backup
```

The exact failover behaviour should be client/platform-specific but use the same local stream group.

---

# 43. Alias-learning architecture

Learning can improve data quality without sending private stream data.

## 43.1 Team alias candidate

Example observation:

```text
EPG raw team:
Man Utd

canonical:
Manchester United

evidence:
other participant exact
kickoff within 2 min
competition exact
3 independent occurrences
```

Create:

```text
status=candidate
confidence=0.997
observations=3
```

Promotion policy should require:
- high confidence
- repeated observations OR deterministic context
- no conflicting canonical mapping

## 43.2 Channel alias candidate

Client may optionally report:

```json
{
  "normalized_alias": "vsport pl",
  "logical_channel_id": "no_vsport_premier_league",
  "country": "NO",
  "mapping_method": "user_confirmed"
}
```

Never send stream URL.

Aggregate agreement before global promotion.

---

# 44. Alias poisoning protection

Never accept global aliases from one anonymous observation.

Require combinations of:
- repeated independent observations
- high-confidence existing mapping
- trusted/internal seed
- manual verification
- conflict checks

Example unsafe alias:

```text
"United" → Manchester United
```

Reject because it is insufficiently specific.

---

# 45. Debug / auditability

Every automatic decision must be explainable.

Required internal API concept:

```text
GET /internal/resolution/events/{event_id}/explain
```

Example output:

```json
{
  "event": "Manchester United vs Arsenal",
  "candidate": "V Sport Premier League / Man Utd v Arsenal",
  "score": 97,
  "classification": "CONFIRMED",
  "signals": [
    {"type":"participant","value":"Man Utd","resolved":"Manchester United","score":30},
    {"type":"participant","value":"Arsenal","resolved":"Arsenal","score":30},
    {"type":"time","delta_minutes":-5,"score":20},
    {"type":"competition","value":"Premier League","score":10},
    {"type":"source","source":"primary_no","score":5},
    {"type":"broadcaster_hint","value":"Viaplay","score":2}
  ],
  "penalties": [],
  "runner_up": {
    "score": 68
  }
}
```

---

# 46. Unmatched queue

Maintain structured unresolved cases.

Fields:

```text
entity_type
event_id
raw_value
candidate_values
top_score
second_score
reason
first_seen
last_seen
count
status
```

Statuses:
- new
- reviewing
- alias_added
- source_issue
- unsupported_pattern
- no_linear_broadcast
- ignored
- resolved

The unmatched queue is a product-quality input, not a failure to hide.

---

# 47. Ambiguous queue

Separate ambiguous from unknown.

Example:

```text
two channels
same programme title
same time
two plausible variants
```

Do not auto-collapse ambiguity.

Ambiguity can be legitimate simulcast.

Data model must support multiple correct channels.

---

# 48. Sport-specific resolver interface

Do not build one universal regex monster.

```python
class EventResolver:
    def build_candidates(self, event, programmes):
        ...
    def score_candidate(self, event, programme):
        ...
    def classify(self, ranked_candidates):
        ...
```

Implementations:

```text
FootballResolver
BasketballResolver
IceHockeyResolver
TennisResolver
MotorsportResolver
GolfResolver
```

---

# 49. Football resolver details

Primary:
- two teams
- time
- competition

Secondary:
- venue
- country
- broadcaster hint
- live category

Hard distinctions:
- gender
- age group
- reserve team

---

# 50. NBA/NFL/NHL resolver

Similar to football but support:
- city abbreviations
- franchise nicknames
- common abbreviations
- `@` notation

Example:

```text
KC @ PHI
Kansas City Chiefs at Philadelphia Eagles
Chiefs vs Eagles
```

Aliases must be sport/league-scoped where ambiguous.

---

# 51. Tennis resolver

Tennis is harder because:
- schedule times shift
- player names vary
- order can reverse
- tournaments have many simultaneous matches

Weight:
- player A
- player B
- tournament
- court if available
- time with weaker rigidity

Support:
- surname-only EPG
- initials
- diacritics
- doubles pairs

Do not deploy tennis until football metrics are stable.

---

# 52. Motorsport resolver

No team-vs-team parser.

Canonical event example:

```text
Formula 1
Belgian Grand Prix
Qualifying
```

Match:
- series
- event/grand prix
- session type
- date/time
- circuit/location

Session types:
- practice 1/2/3
- sprint
- sprint qualifying
- qualifying
- race

Session type conflict should be strong negative evidence.

---

# 53. Golf resolver

Match:
- tournament
- tour
- round
- date
- broad time window

Golf programme titles are often generic, so source/channel context can carry more weight.

---

# 54. API contracts — cloud to app

## 54.1 Today's events

```http
GET /v1/events?date=2026-08-17&country=NO
```

Response sketch:

```json
{
  "events": [
    {
      "id": "evt_123",
      "sport": "football",
      "competition": {
        "id": "football_eng_premier_league",
        "name": "Premier League"
      },
      "start_time": "2026-08-17T18:00:00Z",
      "participants": [
        {"id":"football_eng_manchester_united","name":"Manchester United"},
        {"id":"football_eng_arsenal","name":"Arsenal"}
      ],
      "broadcasts": [
        {
          "logical_channel_id": "no_vsport_premier_league",
          "name": "V Sport Premier League",
          "country": "NO",
          "confidence": 0.982,
          "classification": "CONFIRMED",
          "broadcast_type": "LINEAR"
        }
      ]
    }
  ]
}
```

Do not expose raw EPG internals unless debug/admin endpoint.

---

# 55. Logical channel catalogue API

```http
GET /v1/channels/catalog?country=NO
```

Return:

```json
{
  "version": "2026-08-17T16:00:00Z",
  "channels": [
    {
      "id": "no_vsport_premier_league",
      "name": "V Sport Premier League",
      "country": "NO",
      "aliases": [
        "V Sport PL",
        "Viasport Premier League"
      ],
      "external_ids": {
        "xmltv": ["..."]
      }
    }
  ]
}
```

The app caches this catalogue.

---

# 56. Local catalogue versioning

App stores:
- catalogue version
- mapping algorithm version
- alias version

Re-run local mappings if:
- user playlist changes
- catalogue version changes materially
- local algorithm version changes

Do not rematch on every app launch.

---

# 57. Privacy and secret-handling

## 57.1 Never log

- M3U credentials
- Xtream password
- access tokens
- raw stream URLs
- query strings containing credentials

## 57.2 URL sanitizer

Any local logs must sanitize:

```text
http://host/user/password/channel.ts
```

to something like:

```text
http://host/***/***/channel.ts
```

or hash the source.

## 57.3 Server-side telemetry

If device telemetry is added:
- opt-in/appropriate consent
- no secrets
- no raw URL
- no complete playlist
- documented retention

---

# 58. Reliability / resilience

Every external integration must implement:
- timeout
- retry with backoff
- circuit-breaker or equivalent failure suppression
- stale-cache fallback
- source health status
- structured logs
- metrics

Never let one dead EPG source block all event resolution.

---

# 59. EPG-source fallback

If primary source is unavailable:

```text
primary fresh cache
↓
secondary source
↓
older primary cache if within acceptable maximum age
↓
unknown
```

Do not silently replace high-quality local source with low-quality data without recording which source won.

---

# 60. Caching

Recommended layers:

```text
sports provider response cache
canonical entity cache
EPG source file cache
parsed EPG database
programme candidate query cache
event resolution cache
channel catalogue cache
client local catalogue cache
client local stream-health cache
```

Cache invalidation triggers must be explicit.

---

# 61. Database retention

Suggested starting retention:

- sports future events: provider-dependent
- past events: 30–90 days minimum for quality analysis
- EPG programmes: 14–30 days
- raw EPG source file: last 2–3 successful versions
- resolution explanations: 90 days
- alias observations: long-lived
- source-health metrics: aggregate long-term, raw shorter

---

# 62. Testing strategy

A resolver without a gold dataset is not production-ready.

## 62.1 Build a fixture corpus

Create:

```text
/tests/fixtures/football/
```

with real-world variants:

```text
Manchester United vs Arsenal
Man Utd v Arsenal
Man United - Arsenal
Manchester Utd vs Arsenal
LIVE PL: Man Utd v Arsenal
Arsenal v Man Utd
```

and negative examples:

```text
Manchester City v Arsenal
Manchester United Women v Arsenal Women
Manchester United U21 v Arsenal U21
```

---

# 63. Gold dataset

Create manually verified rows:

```csv
event_id,epg_title,epg_channel,expected_match,expected_channel
...
```

At minimum:
- 500 football programmes before production
- multiple countries
- multiple sources
- aliases
- reversed teams
- wrong opponents
- women/youth
- competition conflicts
- studio shows
- vague programme titles

Increase over time.

---

# 64. Regression testing

Every bug becomes a permanent fixture.

If resolver once maps:

```text
Manchester City
→ Manchester United
```

incorrectly, add that exact case to regression tests before fixing.

No matching change is complete without tests.

---

# 65. Shadow mode

Before relying on resolver output in production:

1. run new resolver in shadow mode
2. retain existing behaviour
3. record predictions
4. manually/sample verify
5. compare precision
6. only activate when thresholds met

Use same process for scoring-model updates.

---

# 66. Algorithm versioning

Store:

```text
resolver_version
normalizer_version
alias_dataset_version
channel_catalog_version
```

with each match.

If quality drops after deployment, rollback is possible.

---

# 67. Observability

Metrics:

```text
epg_fetch_success_total
epg_fetch_failure_total
epg_source_age_seconds
epg_programmes_ingested_total
events_resolved_total
events_unknown_total
events_ambiguous_total
event_match_confidence_histogram
resolver_runtime_seconds
alias_candidates_created_total
channel_mapping_unknown_total
```

Logs should include IDs, not secrets.

---

# 68. Quality dashboard data

Even if UI is out of scope, backend must expose enough data to build:

```text
Supported events today
Resolved %
Confirmed %
Probable %
Unknown %
Ambiguous %
Incorrect verified %
EPG source freshness
Source failures
Top unknown aliases
Top unmatched channels
```

---

# 69. AI coding-agent rules

Place these rules in the repository's AI instruction file.

## 69.1 Reuse-first rule

Before implementing any generic capability:

```text
1. Search current repository.
2. Search approved open-source dependencies/reference repos.
3. Determine whether a mature library already solves it.
4. Integrate or adapt when appropriate.
5. Build custom only if necessary.
```

## 69.2 Do not reinvent

AI must not create from scratch without explicit reason:
- XML parser
- M3U parser
- fuzzy string algorithm
- HTTP retry framework
- cron scheduler
- timezone library
- SQL migration system
- stream probing implementation if suitable platform/library exists

## 69.3 License gate

Before copying external source:

```text
1. Identify exact repository + commit/tag.
2. Read LICENSE.
3. Record license in /docs/third-party.md.
4. Decide copy vs dependency vs separate service.
5. Preserve required notices.
6. If unclear, do not copy.
```

## 69.4 Small-change rule

AI tasks should be independently verifiable.

Bad:

```text
Build the EPG system.
```

Good:

```text
Add XMLTV ingestion for one configured source and store channels/programmes.
Do not implement matching in this task.
Include tests and metrics.
```

---

# 70. Recommended repository structure

```text
/apps/
    tizen/
    web/

/services/
    api/
    resolver/
    epg-ingest/
    scheduler/

/packages/
    domain/
    normalizers/
    matching/
    channel-catalog/
    shared-types/

/integrations/
    sports-provider/
    iptv-org-epg/
    dispatcharr-adapter/        # prototype / optional
    teamarr-reference/          # docs/tests, not copied blindly

/docs/
    DATA_QUALITY_BLUEPRINT.md
    THIRD_PARTY.md
    MATCHING_RULES.md
    OPERATIONS.md

/tests/
    fixtures/
    gold/
    regression/
```

If existing Ninety repository has a different structure, adapt rather than forcing a rewrite.

---

# 71. Service boundaries

## `epg-ingest`

Responsibilities:
- fetch guide
- validate
- parse
- normalize channel/programme base fields
- store
- publish changed-window event

Does not:
- resolve sports events

## `resolver`

Responsibilities:
- candidate generation
- entity resolution
- sport-specific scoring
- confidence classification
- logical channel mapping
- explanation

## `api`

Responsibilities:
- expose events
- expose logical channel catalogue
- expose resolution result
- no raw private playlist

## client

Responsibilities:
- private playlist
- local mapping
- probing
- playback

---

# 72. Background jobs

Suggested jobs:

```text
sports:refresh-events
epg:fetch-source
epg:ingest
epg:health-check
resolver:precompute
resolver:rerun-affected
aliases:promote-candidates
aliases:detect-conflicts
quality:compute-metrics
cleanup:retention
```

Each job must be idempotent where possible.

---

# 73. Event reprocessing triggers

Rerun event resolution when:
- sports provider changes kickoff
- participants change
- event postponed
- competition corrected
- EPG programme changes near event
- EPG source priority changes
- alias accepted/rejected
- logical-channel mapping changes
- resolver version changes

---

# 74. Postponements / cancellations

Sports API status wins for event existence/status.

If event moves:
1. update canonical event time
2. invalidate previous EPG matches
3. rerun candidate window
4. preserve audit trail
5. mark obsolete match inactive

---

# 75. Programme repeats / highlights

Prevent a highlights show from matching the live event.

Negative/metadata evidence:
- `highlights`
- `review`
- `replay`
- `repeat`
- `classic`
- `magazine`
- `preview`

Maintain language-aware dictionaries.

Example:

```text
Premier League Highlights: Man Utd v Arsenal
```

should not resolve as the live match solely because teams match.

---

# 76. Pregame shows

Pregame is trickier.

Example:

```text
Man Utd v Arsenal: Build-Up
19:00–20:00
```

This identifies the event but may be on the same broadcaster.

Use it as supporting evidence for channel discovery, but prefer the programme overlapping live match time when available.

Possible programme classification:
- `LIVE_EVENT`
- `PREGAME`
- `POSTGAME`
- `HIGHLIGHTS`
- `REPLAY`
- `STUDIO`
- `UNKNOWN`

---

# 77. Programme classification

Rule-based V1 is sufficient.

Signals:
- title keywords
- categories
- time relation
- subtitle
- description

Do not use an LLM for every programme.

LLM/AI may later be used offline for:
- suggesting new alias rules
- analyzing unknown patterns
- generating test cases

It must not be a critical online resolver dependency.

---

# 78. LLM fallback policy

If ever introduced:

Only run on:
- unresolved high-value events
- tiny candidate set
- no hard conflicts
- no secrets

LLM result must never automatically override:
- stable IDs
- verified aliases
- explicit contradictory participant evidence

Prefer LLM to propose a candidate for deterministic validation.

---

# 79. Data-quality invariants

Implement automated invariant checks.

Examples:

```text
A logical channel ID cannot represent two different numbered channels.
An accepted alias cannot map to two active entities in the same scope.
An event cannot have duplicate identical active programme matches.
A confirmed match cannot contain a hard participant conflict.
An EPG programme end must be after start.
A stale source cannot create new CONFIRMED results if policy forbids it.
```

---

# 80. Manual corrections

Manual corrections must be durable and highest priority.

If an operator verifies:

```text
epg_source/channel ABC
→ no_vsport_premier_league
```

store as `manual_verified`.

Future fuzzy updates must not replace it automatically.

Manual event correction should optionally create:
- alias candidate
- channel mapping correction
- regression test suggestion

---

# 81. Unknown handling

Unknown is a valid state.

Client receives:

```json
"broadcasts": []
```

or:

```json
{
  "classification": "UNKNOWN"
}
```

Do not fill with sports API streaming provider pretending it is a linear channel.

---

# 82. Country / market handling

Every logical channel should be market-scoped.

Examples:

```text
NO
GB
US
SE
DK
```

App can prioritize:
1. user's configured market
2. markets represented in playlist
3. user language/preference
4. other available channels only if requested

Do not treat same channel brand in two markets as necessarily identical.

---

# 83. User playlist market inference

Local only, possible hints:
- group prefixes `NO`, `UK`, `US`
- channel aliases
- tvg-id suffix
- group-title
- provider organization

Do not rely on market inference alone to establish identity.

---

# 84. Data acquisition legality / terms

Open-source software license does not automatically grant rights to scrape or redistribute third-party guide data.

Before production:
- review terms of selected EPG sources
- confirm redistribution/API use rights
- avoid exposing copyrighted full guide datasets publicly if rights are unclear
- prefer processing data for resolver output rather than republishing entire guides when appropriate

This is a product/legal review, not only an engineering concern.

---

# 85. Prototype architecture

Fastest proof-of-concept:

```text
Sports API
    ↓
Ninety Resolver
    ↓
Postgres
    ↑
EPG from iptv-org/custom XMLTV

Optional:
Dispatcharr container for comparison/testing
Teamarr container/code analysis for sports matching patterns
```

For prototype, Dispatcharr can be used as a reference/control system without making Ninety production-dependent on its AGPL internals.

---

# 86. MVP proof condition

Do not expand scope until this chain works robustly:

```text
Sports API:
Manchester United vs Arsenal
20:00

EPG:
19:55 Man Utd v Arsenal
Channel: V Sport Premier League

Cloud:
event → no_vsport_premier_league

TV:
NO | V SPORT PL UHD
NO | V SPORT PL FHD

Local mapping:
both → no_vsport_premier_league

Playback:
UHD preferred, FHD fallback
```

Success criteria:
- correct event
- correct linear channel
- correct logical ID
- local stream found
- no server knowledge of stream URL
- match explanation recorded

---

# 87. MVP implementation sequence

## Milestone 1 — Research / dependencies

- inspect Teamarr architecture
- inspect Dispatcharr EPG auto-match
- inspect iptv-org source configuration
- inspect Tuliprox normalization/probing concepts
- document licenses
- decide dependencies

Deliverable:
`docs/THIRD_PARTY.md`

## Milestone 2 — EPG ingestion

- one Norwegian EPG source
- selected sports channels only
- XMLTV parse
- store channels/programmes
- source health
- tests

Acceptance:
query programme schedule for V Sport / equivalent target channel.

## Milestone 3 — Canonical football model

- teams
- team aliases
- competitions
- competition aliases
- provider external IDs
- events

Acceptance:
sports API event normalizes deterministically.

## Milestone 4 — Programme parser

Support:
- `A vs B`
- `A v B`
- `A - B`
- `A mot B`
- competition prefix
- LIVE prefix
- quality suffix

Acceptance:
fixture corpus parses correctly.

## Milestone 5 — Participant resolver

Implement matching priority and conflicts.

Acceptance:
Manchester City must not resolve to Manchester United in negative cases.

## Milestone 6 — Event scorer

- participant scores
- time
- competition
- source
- negative scores
- runner-up margin
- explanation

Acceptance:
gold dataset precision gate met.

## Milestone 7 — Logical channels

- logical registry
- EPG channel mapping
- aliases
- country scope

Acceptance:
EPG programme maps to stable Ninety channel ID.

## Milestone 8 — Event API

Return event + broadcast logical channels.

Acceptance:
client can consume without raw EPG dependency.

## Milestone 9 — Client local mapping

- parse existing playlist skeleton
- tvg-id exact
- aliases
- normalized channel matching
- quality extraction

Acceptance:
V Sport PL UHD/FHD map to same logical channel.

## Milestone 10 — Stream health / fallback

- local reachability
- measured quality
- ranking
- fallback

Acceptance:
failed UHD falls back without cloud involvement.

---

# 88. Expansion sequence

After Norwegian football is stable:

1. Champions League / Europa League / Conference League
2. Premier League and top-5 leagues
3. UK EPG
4. other Nordic markets
5. European markets
6. basketball/hockey
7. tennis
8. F1
9. golf
10. US sports/market only after data-source quality is validated

Do not expand geography and sport simultaneously during resolver calibration.

---

# 89. Release gates

Before adding a new country:
- EPG source documented
- freshness acceptable
- channel catalogue coverage
- at least 100 verified target-event samples
- precision target met

Before adding a new sport:
- sport-specific resolver implemented
- fixtures created
- gold dataset created
- negative cases documented
- no regression in existing sports

---

# 90. Common failure modes and required behaviour

## Failure: EPG says `Man Utd`
Expected:
accepted alias → Manchester United.

## Failure: EPG says `Manchester City v Liverpool`
Target:
Manchester United v Liverpool.
Expected:
reject due known participant conflict.

## Failure: sports API says `Viaplay`
EPG finds `V Sport Premier League`.
Expected:
linear channel from EPG; Viaplay only supporting hint.

## Failure: sports API says `Viaplay`
No linear EPG match.
Expected:
streaming-only/unknown linear broadcast. Do not invent V Sport.

## Failure: EPG says `Premier League Live`
No participants.
Expected:
weak/unknown unless description or other programme metadata resolves event.

## Failure: EPG says `Man Utd v Arsenal Highlights`
Expected:
not the live event.

## Failure: two EPG sources disagree.
Expected:
rank by source quality + event evidence; preserve source identity.

## Failure: app M3U says `NO | V SPORT PL FHD`.
Expected:
local alias/normalization → `no_vsport_premier_league`.

## Failure: `V Sport 1` and `V Sport 2`.
Expected:
remain distinct.

## Failure: user playlist has 4 variants of same channel.
Expected:
one logical channel, four local stream sources.

---

# 91. Data-quality decision tree

```text
Does the sporting event exist canonically?
    NO → cannot resolve broadcast
    YES
      ↓
Are fresh EPG sources available?
    NO → use permitted stale fallback / UNKNOWN
    YES
      ↓
Generate time-window candidates
      ↓
Can participants be deterministically resolved?
    YES → strong candidate path
    NO → alias / scoped fuzzy / metadata fallback
      ↓
Any explicit conflicts?
    YES → reject candidate
    NO
      ↓
Score time + competition + source + hints
      ↓
Compare top vs runner-up
      ↓
CONFIRMED / PROBABLE / AMBIGUOUS / UNKNOWN
      ↓
Map EPG channel → logical channel
      ↓
Expose to client
      ↓
Client maps logical channel → local stream(s)
```

---

# 92. Engineering definition of done

A feature touching data resolution is not done unless:

- implementation exists
- unit tests exist
- negative tests exist
- fixture added
- logging/explanation exists
- no secrets logged
- migration included if schema changes
- documentation updated
- quality metric impact checked
- external license reviewed if new code/dependency is used

---

# 93. Coding-agent task template

Every task given to AI should follow:

```text
Objective:
[one small capability]

Existing components to inspect first:
[list]

Constraints:
- reuse before build
- do not change unrelated code
- no UI redesign
- no secret upload
- preserve original raw data
- include tests
- document matching decisions

Acceptance tests:
[specific inputs / expected outputs]

Out of scope:
[list]

Deliverables:
[files/migrations/tests]
```

---

# 94. Example first AI task

```text
Objective:
Implement XMLTV ingestion for one configured Norwegian EPG source.

Inspect first:
- current Ninety backend
- existing XML/XMLTV dependencies
- iptv-org/epg output format
- Dispatcharr XMLTV handling only as architecture reference

Requirements:
- preserve channel id, display name, title, subtitle, description, category, start, stop
- normalize timestamps to UTC
- compute raw programme hash
- upsert channels/programmes
- source freshness and failure tracking
- atomic failed-update behaviour
- no sports event matching in this task

Acceptance:
- fixture XMLTV imports successfully
- duplicate import is idempotent
- changed programme updates
- corrupt XML leaves previous good data intact
- DST test exists
```

---

# 95. Example second AI task

```text
Objective:
Implement football team entity resolution.

Requirements:
- canonical exact
- accepted alias
- normalized exact
- scoped abbreviation
- fuzzy only as fallback
- country/competition context
- significant-token conflict handling

Mandatory regression tests:
- Man Utd → Manchester United
- Manchester Utd → Manchester United
- Manchester City ≠ Manchester United
- Manchester United Women ≠ Manchester United men
- Manchester United U21 ≠ senior
```

---

# 96. Example third AI task

```text
Objective:
Resolve a canonical football event to EPG programmes.

Input:
Manchester United vs Arsenal, Premier League, kickoff 20:00.

Candidate examples:
19:55 Man Utd v Arsenal
19:45 Manchester City v Arsenal
20:00 Arsenal v Man United
22:30 Man Utd v Arsenal Highlights

Expected:
- candidate 1 strong
- candidate 2 rejected
- candidate 3 strong despite reversed order
- highlights rejected as live event
- explanation stored for all
```

---

# 97. What not to build yet

Do not spend time on:
- global all-channel EPG
- AI/LLM online matching
- automatic global aliases from one observation
- distributed microservice complexity
- Kafka/event streaming unless scale proves necessary
- machine learning model
- custom XML parser
- custom fuzzy-distance algorithm
- full US market before Europe is stable
- full EPG UI
- cloud-side storage of user playlists

---

# 98. Long-term opportunities

After core precision is proven:

- verified crowd-sourced alias improvement
- per-market EPG quality model
- automatic source selection by historical correctness
- probabilistic ensemble resolver
- automatic new-channel discovery
- cross-source programme reconciliation
- country coverage health scoring
- admin tooling to generate regression fixtures from corrections
- LLM offline analysis of unknown patterns
- user-side anonymous mapping feedback
- device-aware codec/quality ranking
- localized programme language support

---

# 99. Final architecture rulebook

1. Sports API tells Ninety **what is happening**.
2. EPG tells Ninety **what real linear channel is airing it**.
3. Broadcaster API is a **hint**, not truth.
4. Names are labels; stable canonical IDs are identities.
5. Exact IDs beat aliases.
6. Accepted aliases beat fuzzy matching.
7. Entity matching beats full-title string similarity.
8. Explicit contradictions beat partial similarity.
9. Time is a major signal.
10. Competition is supporting evidence.
11. Multiple broadcasters can simultaneously be correct.
12. Source quality and freshness must be explicit.
13. `UNKNOWN` is better than a wrong result.
14. Every match must be explainable.
15. Every matching bug becomes a regression test.
16. User stream URLs and credentials stay local by default.
17. Server resolves event → channel.
18. Client resolves channel → stream.
19. Open source must be reused where sensible, subject to license.
20. AI must integrate before reinventing.
21. Data quality metrics are product metrics.
22. Resolver changes must be versioned and measurable.
23. Scale only after precision is proven.
24. Start with one market and football.
25. Do not design UI around uncertain data; improve the data first.

---

# 100. Immediate next actions

The coding agent should execute these in order:

### Step 1
Create `docs/THIRD_PARTY.md` and inspect current licenses/API surfaces for:
- Dispatcharr
- Teamarr
- iptv-org/epg
- Tuliprox
- any EPG Janitor dependency considered

### Step 2
Select one Norwegian EPG source and prove automated XMLTV generation/import for a small set of sports channels.

### Step 3
Implement the central tables:
- teams
- team aliases
- competitions
- events
- EPG sources/channels/programmes
- logical channels
- event-channel matches

### Step 4
Build a real fixture pack using actual programme-title variants from the selected EPG.

### Step 5
Implement only the football entity resolver and programme parser.

### Step 6
Build and calibrate the scoring model against the fixture/gold dataset.

### Step 7
Create the logical-channel registry and map the first Norwegian channels.

### Step 8
Return logical broadcast channel IDs through the existing Ninety event API.

### Step 9
Connect the existing app skeleton to the logical-channel catalogue and map the private local playlist.

### Step 10
Validate the full chain on real upcoming matches before expanding.

---

# 101. Research basis / reusable projects

The architecture above intentionally borrows proven patterns from these projects while keeping Ninety's unique event-to-linear-channel resolver as its own product logic.

- Dispatcharr — IPTV stream/channel/EPG management, XMLTV, EPG auto-match, failover  
  https://github.com/Dispatcharr/Dispatcharr

- Teamarr — sports-event EPG generation, aliases, fuzzy matching, regex extractors, Dispatcharr integration  
  https://github.com/Pharaoh-Labs/teamarr  
  https://pharaoh-labs-teamarr.mintlify.app/

- iptv-org/epg — EPG download/generation tooling, custom channel lists, Docker, XMLTV  
  https://github.com/iptv-org/epg

- Tuliprox — multi-source IPTV processing, normalization, mapping, probing, failover concepts  
  https://github.com/euzu/tuliprox

Before reusing source code, the coding agent must verify the exact current license and version/commit of every dependency.

---

# 102. One-sentence source of truth

> **Ninety Cloud determines which real, canonical linear channels are broadcasting each canonical sports event; the Ninety client privately maps those channel IDs to the user's own available streams and chooses the best playable source.**

