# NINETY — Google TV → Samsung Tizen TV: plan

> Statusdokument. Oppdateres fortløpende etter hvert steg er gjort. Hver ny session starter med å lese denne filen for å vite hva som er gjort og hva som er neste steg.

**Sist oppdatert:** 2026-08-13
**Neste steg:** Brukertest hele fotball-datalaget etter bytte til Sportmonks (Steg 35) — verifiser at Home viser riktige kamper/live-status/logoer/runde, og se over event-details-skjermens nye lag-logoer/referee/venue/two-leg-aggregat (Steg 34).

**Steg 35 — FERDIG (2026-08-13): Byttet fotball-datakilde helt fra api-football til Sportmonks**

Rett etter Steg 34 (se under) oppdaget bruker at appen sluttet å laste data — root cause: api-footballs gratis 100/dag-kvote var brukt opp av mine egne `curl`-undersøkelser tidligere i økten (referee-felt, venue-data, paginering) mot samme nøkkel appen selv bruker. Bruker sin respons: "bare hent alle kampene fra Sportmonks, jeg fokuserer bare på topp 5 + UEFA uansett" — siden Sportmonks allerede eier nøyaktig de 8 ligaene (topp-5 + CL/EL/ECL), er det ingen grunn til å beholde to fotball-leverandører.

- ✅ Slettet `apiFootballClient.ts` helt, fjernet `VITE_API_FOOTBALL_KEY` fra `.env`/`.env.example` (med forklarende kommentar om hvorfor).
- ✅ `sportmonksClient.ts` utvidet kraftig: samme daglige, paginerte `/fixtures/date/`-kall som allerede fantes for kringkasterdata henter nå OGSÅ `participants` (lag+logoer), `venue`, `stage`/`round` (rundetekst), `referees.referee` (dommernavn), `league`, `state` (kamp-status) og `scores` (live måltall) — ett kall dekker nå både Home-kamplisting og kanal-matching, ikke to separate datakilder.
- ✅ Ny `mapSportmonksFixture()` i `mapEvent.ts` erstatter `mapApiFootballFixture` — bruker ekte Sportmonks `state_id` (bekreftet via `/v3/football/states`) til å avgjøre live-status, og `scores`-arrayets `CURRENT`-oppføringer til faktisk levende målscore, i stedet for et separat `livescore.php`-kall til TheSportsDB.
- ✅ **Fjernet TheSportsDB sin fotball-live-vei helt** (`fetchLiveScores`, `fetchLeagueBadge`, `mapLiveScore`, `RawSportsDbLiveScore` — alle nå døde og slettet) — Sportmonks sin `state`/`scores`-data i samme kall gjør denne separate oppslags-mekanismen overflødig.
- ✅ `leagues.ts`: `apiFootballId` byttet til `sportmonksLeagueId` (bekreftet direkte mot `/v3/football/leagues` for alle 8 ligaer — PL=8, CL=2, EL=5, ECL=2286, La Liga=564, Serie A=384, Bundesliga=82, Ligue 1=301). **Eredivisie/Primeira Liga/MLS/Championship fjernet helt fra katalogen** — de var aldri på Sportmonks-planen, og bruker bekreftet at topp-5+UEFA er alt de faktisk bryr seg om.
- ✅ `LIVE_NOW_ELIGIBLE_FOOTBALL_LEAGUE_IDS` (fra Steg 32/33-økten) fjernet helt — nå som *hele* fotball-katalogen er topp-5+UEFA, er den separate liga-sperren i Live Now-filteret overflødig (kanal-match-sjekken alene er nok).
- ✅ Verifisert direkte mot levende API (ikke bare `tsc`): paginering henter alle 37 kamper for dagen, live-status/skår/venue/referee/runde stemmer for en faktisk pågående kamp (Tobol vs Partizan, 1-0, 1st half).
- ⚠️ **Viktig lærdom, dokumentert for fremtidige økter:** `npx tsc --noEmit` er en **no-op** i dette prosjektet — rot-`tsconfig.json` bruker project references med `files: []`, så ekte typesjekk krever `tsc -b` (det `npm run build`/`build:tizen` faktisk kjører). Underveis i denne økten ble `tsc --noEmit` brukt feilaktig som verifikasjon flere ganger uten å faktisk sjekke noe — fanget opp og rettet før commit-verdig tilstand, men verdt å huske: bruk `npx tsc -b` eller `npm run build:tizen` for ekte verifikasjon fremover, ikke `tsc --noEmit`.
- ✅ `npx tsc -b`, `npm run lint` (oxlint), `npm run build:tizen` alle grønt.

**Steg 34 — FERDIG (2026-08-13): Event-details-skjermen betydelig utvidet**

Bruker ba om "alt som gjør den så bra som mulig" for kamp-detalj-skjermen, pluss lag-logoer.

- ✅ Lag-logoer lagt til i en ny side-ved-side matchup-layout (logo+navn+skår per lag, "vs" i midten) — erstatter den gamle enkle stablede tekst-tittelen. `homeBadge`/`awayBadge` var allerede hentet fra tidligere, bare aldri vist på denne skjermen.
- ✅ **Referee og venue+by** lagt til i meta-raden — nye felt (`referee`, `venueCity`) på `SportEvent`, mappet fra Sportmonks (se Steg 35).
- ✅ **Two-legged aggregat-skår** (helt ny funksjonalitet): Sportmonks sin `leg`/`aggregate_id` (allerede tilgjengelig på hver kamp uten ekstra kall) brukes til å hente aggregatresultatet via ett ekstra, målrettet Sportmonks-kall (`include=aggregate`) — kun for kamper som faktisk er del av en toveis-oppgjør. Verifisert direkte mot en ekte kamp (Ilves vs Rijeka, leg 2/2, aggregat 1-0).
- ✅ Live skår/klokke vist i header når kampen er live (fantes i datamodellen, var aldri rendret på denne skjermen før).
- ✅ Layout omstrukturert: liga-badge+navn og LIVE/runde/leg-tagger på egen header-rad, matchup-seksjon under, meta-rad (tid/venue/by/referee) nederst.

**Steg 33b — mindre iterasjoner samme økt:**
- Kanal-matching presisjon: `PREMIUM` lagt til generiske ord (falsk-positiv-fiks), nummer-sperre gjort obligatorisk når stasjonsnavn har tall (fikset "Arena Sport Premium 1" som matchet "Arena Fight"/"Arena eSport"/"NTV Arena"), krav om minst to merkevare-ord for flerords-stasjonsnavn (fikset "Arena Cloud" som matchet "Arena Premium 4").
- Kanal-matching dekning: Sportmonks-kallet paginerte ikke (fant kun 25 av 37 kamper — root cause til at en bekreftet reell kamp viste "ingen kanal funnet"), fikset i `fetchFixturesForDate`.
- Land-gjenkjenning: `SR`/`BH`/`KU`-kode-prefikser (Serbia/Bosnia/Kurdisk — ikke-ISO-koder denne spesifikke playlisten bruker) lagt til `countryCodes.ts`.
- Kanal-matching skopet til kanalens eget land (unngår at en Kasakhisk/Bosnisk stasjon matcher en norsk kanal av en tilfeldig felles generisk ord).
- Ny "Resync playlist"-knapp i Admin-panelet — tømmer kun cachet kanalliste (ikke onboarding/preferanser/filter), for å teste normaliseringsfikser uten full reset.
- "No results"-årsak vist i UI (API har ingen data vs. API har data men ingen kanal-match), pluss "Think we got it wrong? Check your channels manually"-knapp til Channels-skjermen.
- Golf/Tennis/MMA/Basketball fjernet helt fra appen (se Steg 34-notatet over sin kontekst) — erstattet av "Your Favorite Channels"-seksjon på Home (`useFavoriteChannelsNowPlaying.ts`) som viser «now playing» for brukerens favorittmerkede kanaler via EPG, i stedet for automatisk kamp-til-kanal-gjetning for sporter uten kringkasterdata-API.

**Steg 34 — FERDIG (2026-08-13): Fjernet golf/tennis/MMA/basketball, lagt til "Live on Your Favorite Channels"**

Brukertesting av kanal-matching (Steg 33) avdekket flere reelle bugs underveis (Sportmonks-paginering manglet — kun side 1 av 37 kamper ble hentet, PREMIUM/nummer-sperre-false-positives, golf-heuristikk brukte en midnatt-placeholder-timestamp fra TheSportsDB som aldri kunne stemme). Da spørsmålet "finnes det en golf-API med kringkasterdata, slik som Sportmonks for fotball" ble undersøkt, viste det seg at **ingen** golf-API (Sportmonks selv, SportsDataIO, Goalserve) tilbyr kringkaster-/TV-kanal-data i det hele tatt — det er en fotball-spesifikk nisje kommersielt. Bruker valgte da å forenkle radikalt i stedet for å bygge videre på en heuristikk uten ekte data:

- ✅ Fjernet golf/tennis/MMA/basketball helt: `SportKey` er nå kun `'football' | 'f1'`, fjernet fra `leagues.ts`, `heroScoring.ts` (prestisje-vekter), `liveHeuristic.ts` (forenklet til kun F1s sesjons-varighet-gjetting siden golfs spesialtilfelle ikke lenger trengs), onboardingens sport-plukker, og de nå ubrukte SVG-ikonene (`BasketballIcon`/`TennisIcon`/`GolfIcon`/`MmaIcon`) i `sportIcons.tsx`.
- ✅ Ny seksjon på Home: **"Live on Your Favorite Channels"** (`useFavoriteChannelsNowPlaying.ts`, ny) — for hver kanal brukeren har favorittmerket i Channels-browsingen, hentes «now playing»-tittelen via Xtream `get_short_epg` (samme API som EPG-fallbacken i kanal-matchingen). Dette er den bevisste erstatningen for automatisk kamp-til-kanal-matching for sporter vi ikke lenger følger: i stedet for å gjette hvilken kanal som viser f.eks. golf, favorittmerker brukeren selv kanalen (f.eks. "V Golf") og ser hva som faktisk spilles der nå, uten at appen påstår noe den ikke vet.
- ✅ `HomeScreen`/`App.tsx` fikk `favoriteChannels`/`onWatchChannel` koblet gjennom — trykk på et favoritt-kanal-kort går rett til avspilling, samme flyt som resten av appen.
- ✅ `tsc --noEmit`, `npm run lint` (oxlint), `npm run build:tizen` verifisert grønt — ingen nye advarsler.
- ⚠️ Ikke visuelt verifisert i nettleser av meg (samme verktøybegrensning som resten av prosjektet) — bruker bør bekrefte at seksjonen vises korrekt når minst én kanal er favorittmerket, og at avspilling fungerer derfra.
- **Bevisst ikke gjort:** Favoritter er fortsatt ikke persistert (samme kjente, aksepterte hull som før — nullstilles ved reload), så seksjonen er tom igjen etter en reload til favoritter er markert på nytt.

---

## 0. Utgangspunkt (kartlagt 2026-08-12)

Prosjektet er et helt ferskt Vite + React 19 + TypeScript-prosjekt, i praksis fortsatt standardmalen:

- `package.json`: react 19.2, react-dom 19.2, `@noriginmedia/norigin-spatial-navigation` (D-pad-navigasjon, plattformnøytral — beholdes)
- `vite.config.ts`: standard `@vitejs/plugin-react`, ingen TV-spesifikk config
- `src/`: kun `App.tsx` (default Vite-mal), `main.tsx`, `index.css`, ett hero-bilde
- `index.html`: standard Vite-mal, ingen TV-meta, ingen Tizen-referanser
- Ingen `config.xml` (Tizen-manifest), ingen Tizen-ikoner, ingen build/pakke-script for `.wgt`
- Ingen Android TV-spesifikk kode funnet i repoet ennå (kun nevnt som opprinnelig mål i chatten) — det betyr at vi slipper å "migrere bort" TV-spesifikk kode, vi må bare **legge til** Tizen-lag før appen bygges videre

Konklusjon: Vi er tidlig nok ute til at Tizen-tilpasning er billig. Viktigste prinsipp fremover: **skriv plattformnøytral React-kode, og legg all Tizen-spesifikk logikk bak et abstraksjonslag** (`core/platform`), slik at Google TV/webOS/nettleser kan legges til senere uten omskriving.

---

## 1. Hvorfor Tizen krever endringer (Google TV vs. Samsung Tizen TV)

| Område | Google TV / Android TV | Samsung Tizen TV |
|---|---|---|
| App-format | APK/AAB, Play Console | `.wgt`-pakke, Tizen Studio / TV Seller Office |
| Manifest | `AndroidManifest.xml` | `config.xml` (W3C Widget-format) |
| Runtime | Android WebView/native | Tizen Web Runtime (Chromium-basert, men egen versjon per TV-årgang, ofte gammel Chromium) |
| Fjernkontroll-input | Android `KeyEvent` | DOM `keydown` med Tizen-spesifikke `keyCode`/`tizen.tvinputdevice` (Back=10009, ChannelUp/Down osv. må registreres eksplisitt) |
| Signering | Play-signering | Tizen-sertifikat (author + distributor) via Tizen Certificate Manager |
| Testing | Android TV-emulator | Tizen TV-emulator eller fysisk Samsung TV + Samsung Remote Test Lab / SDB |
| Distribusjon | Play Store | Samsung Seller Office (TV Seller Office), egen sertifisering/review-prosess |
| Systemknapper | Android tilbake-knapp håndteres av OS | Back-knapp MÅ håndteres manuelt (`tizen.tvinputdevice.registerKey('Back')`), ellers avsluttes ikke appen riktig og TV-en risikerer å avvise appen i sertifisering |
| Ytelse/minne | Relativt rikelig | Strengere minnebegrensninger på eldre TV-modeller (2018-2020 årgang har lite RAM — bør testes) |
| Video-avspilling | Media3/ExoPlayer (native) | HTML5 `<video>` / MSE i nettleser, evt. AVPlay (Tizen native player-API) for DRM/bedre ytelse |

---

## 2. Overordnede faser

### FASE A — Prosjektfundament for Tizen (web-only, ingen native avhengigheter ennå)
1. Legg til `config.xml` (Tizen widget-manifest) i prosjektroten
2. Legg til Tizen-ikoner/splash i riktige størrelser (`icon.png` 117×117 eller etter spec, samt evt. splash)
3. Oppdater `index.html`: fjern Google TV-spesifikke antagelser, legg til viewport/meta tilpasset TV, legg til `tizen`-global type via `@types`-pakke eller egen `.d.ts`
4. Installer Tizen Studio (eller CLI-only: Tizen CLI + Certificate Manager) lokalt for pakking/signering
5. Legg til byggescript: `vite build` → kopier `dist/` inn i `.wgt`-struktur → pakk med Tizen CLI (`tizen package`)
6. Sett opp `tsconfig`: legg til Tizen Web API-typer (`@types/tizen` finnes ikke offisielt — bruk community-typer eller egne `.d.ts`-deklarasjoner for `window.tizen`)

### FASE B — Input og navigasjon
1. Bygg `core/platform`-lag som abstraherer:
   - Registrering av fjernkontrollknapper (`tizen.tvinputdevice.registerKey`)
   - Back-knapp-håndtering (naviger tilbake i app-stack, eller `tizen.application.getCurrentApplication().exit()` på rot-skjerm)
   - Mapping fra `keydown.keyCode` → interne navigasjonsintensjoner (UP/DOWN/LEFT/RIGHT/ENTER/BACK)
2. Verifiser at `@noriginmedia/norigin-spatial-navigation` fungerer med Tizen-spesifikke keyCodes (Samsung bruker delvis avvikende koder fra standard — spesielt Back=10009 vs. nettleserens Escape)
3. Test D-pad-navigasjon i Tizen TV-emulator

### FASE C — TV-tilpasset UI-fundament
1. Design tokens / CSS-variabler for TV-skjerm (1920×1080 fast canvas, ingen responsive mobile-first-tenkning)
2. Skalering: Tizen TV-er har ofte fast 1920×1080 rendering-viewport — sett `viewport` meta og evt. CSS-zoom/scale-strategi eksplisitt (ikke stol på automatisk skalering slik Android TV delvis gir)
3. Focus-styling (grønn kant, subtile transitions) — kan gjenbrukes fra evt. eksisterende designsystem-dokument (`NINETY_Channels_Design_System.md`) som allerede finnes i prosjektet

### FASE D — Video-avspilling
1. Vurder HTML5 `<video>` + MSE vs. Tizen AVPlay-API (AVPlay gir bedre codec-/DRM-støtte på Samsung, men er Tizen-only — legg bak `core/player`-abstraksjon slik at nettleser-fallback finnes)
2. HLS-støtte: `hls.js` for nettleser/eldre Tizen, native HLS der TV-en støtter det

### FASE E — Pakking, signering, testing på enhet
1. Generer Tizen-sertifikat (author certificate) via Certificate Manager
2. Koble til fysisk Samsung TV eller emulator via SDB (`sdb connect <tv-ip>`), aktiver Developer Mode på TV-en
3. Installer og kjør `.wgt` på enhet, test fjernkontroll reelt (emulator dekker ikke alt)

### FASE F — Sertifisering og distribusjon
1. Opprett Samsung Developer-konto + Seller Office-tilgang
2. Gå gjennom Samsung sine sertifiseringskrav (ytelse, minnebruk, back-knapp-oppførsel, app-ikon-spec, splash-timing)
3. Send til sertifisering

---

## 3. Nåværende steg

**Steg 1 — FERDIG (2026-08-12):**
- ✅ `config.xml` opprettet i prosjektroten (W3C widget + `tizen:application`, `tizen:profile name="tv-samsung"`, `tizen:setting` med `hwkey-event="enable"` for Back-knapp-håndtering, landscape-orientering)
  - ⚠️ **TODO før pakking:** `tizen:application id`/`package`-attributtet (`AbCdEfGhIj.NinetyTV` / `AbCdEfGhIj`) er en **placeholder**. Den ekte 10-tegns package-ID-en genereres av Tizen Certificate Manager sammen med author-sertifikatet i Fase E — må byttes ut da, ikke før.
- ✅ Placeholder-ikon `public/tizen/icon.png` (117×117, solid bakgrunnsfarge) generert som plassholder — **ekte NINETY-ikonmerke i lime-grønn/navy-stil (jf. designsystemet) må lages og byttes inn før sertifisering**
- ✅ `index.html` ryddet: peker til Tizen-ikonet, fast TV-viewport (1920×1080, `user-scalable=no`), tittel endret til "NINETY"
- ✅ `src/types/tizen.d.ts` opprettet — minimal ambient-deklarasjon av `window.tizen` (`tvinputdevice`, `application`), utvides etter hvert som flere Tizen-API-er tas i bruk

**Steg 2 — FERDIG (2026-08-12):**
- ✅ Sjekket lokalt miljø: `tizen`/`sdb` CLI er **ikke installert** på denne maskinen, og `@types/tizen` finnes ikke som npm-pakke (bekreftet 404 mot registry). Fortsetter med den håndskrevne `src/types/tizen.d.ts` fra Steg 1.
  - ⚠️ **Manuelt steg du må gjøre selv, utenfor denne økten:** Last ned og installer Tizen Studio (eller CLI-only-pakken) fra Samsung sin utviklerportal. Dette er en stor, lisensbetinget GUI-installasjon som ikke bør/kan automatiseres her. Nødvendig først i Fase E (signering/pakking på ekte enhet).
- ✅ Laget `scripts/build-tizen.mjs`: kjører `vite build`, kopierer `dist/` + `config.xml` inn i en staging-mappe, zipper til en **usignert** `.wgt` (`dist-tizen/ninety-tv.wgt`) med systemets `zip`. Signering/ekte pakking med `tizen package` gjøres senere når Tizen CLI finnes lokalt (Fase E) — scriptet skriver ut riktig kommando som en huskeliste.
- ✅ Lagt til `npm run build:tizen`-script i `package.json`
- ✅ Lagt `dist-tizen/` og `.tizen-staging/` til `.gitignore`
- ✅ **Sidefunn, fikset:** `npm run build` (og dermed `build:tizen`) feilet fra før pga. to manglende filer i Vite-standardmalen (`src/App.css`, `src/assets/react.svg`) som `App.tsx` importerer — helt uavhengig av Tizen-arbeidet. La til minimale placeholder-filer etter avklaring med deg, slik at build-pipelinen kunne verifiseres. Innholdet i `App.tsx`/`App.css` er fortsatt Vite-standardmal og skal byttes ut med ekte NINETY-UI i Fase C.
- ✅ Verifisert: `npm run build:tizen` kjører grønt end-to-end og produserer `dist-tizen/ninety-tv.wgt`

**Steg 3 — FERDIG (2026-08-12): FASE B — Input og navigasjon**
- ✅ `src/core/platform/keys.ts` — `NavIntent`-union (Up/Down/Left/Right/Enter/Back), `keyEventToIntent()` (mapper `keydown.keyCode` → intent; dekker Tizen Back=10009 og browser Escape=27 for dev-fallback), `isTizen()`, `registerTizenRemoteKeys()` (registrerer Back + media-taster via `tizen.tvinputdevice` når API-et finnes), `exitApp()`
  - Merk: `enum` ble byttet til `as const`-objekt + union-type — prosjektets `erasableSyntaxOnly`-TS-innstilling tillater ikke `enum`
- ✅ `src/core/platform/backHandler.ts` — stack-basert Back-routing: skjermer/overlays kan pushe en handler som får første refusal på Back-trykk (f.eks. lukke en modal i stedet for å forlate skjermen); tomt stack → `exitApp()`
- ✅ `src/core/platform/useBackHandler.ts` — React-hook som pusher/popper en Back-handler for komponentens levetid
- ✅ `src/core/platform/index.ts` — barrel-eksport
- ✅ Koblet inn i `src/main.tsx`: `registerTizenRemoteKeys()` + `attachGlobalBackListener()` kalles ved oppstart, samt `init()` fra `@noriginmedia/norigin-spatial-navigation` (biblioteket er plattformnøytralt og trenger ikke Tizen-spesifikk config — det er selve Back-knappen som håndteres utenfor det, siden spatial nav-biblioteket kun bryr seg om piltaster/Enter)
- ⚠️ Reell test av fjernkontroll (spesielt at Back=10009 faktisk trigges) skjer først i Tizen-emulator/fysisk enhet i Fase E. `keyCode: 27` (Escape) er lagt inn som dev-fallback for nettleser-testing i mellomtiden.

**Steg 4 — FERDIG (2026-08-12): FASE C, punkt 1–2 — Designtokens og fast TV-canvas**
- ✅ `src/core/designsystem/tokens.css` — alle CSS-variabler fra `NINETY_Channels_Design_System.md` (farger, spacing, radius, typografi-skala, motion) lagt inn ordrett som kilde til sannhet
- ✅ `src/index.css` ryddet: fjernet Vite-portfolio-malens lys/mørk-tema-CSS, importerer nå designtokens, `color-scheme: dark` (NINETY er TV-only/dark-only, ingen `prefers-color-scheme`-gren), `#root` satt til fast 1920×1080
- ✅ **Skalering avklart som en beslutning, ikke bygget som kode:** Tizen (og Google TV/webOS) rendrer web-viewet allerede i fast oppløsning og skalerer til fysisk panel på OS-nivå — derfor trengs **ingen** JS-drevet CSS-transform-skalering i appen. Dette er dokumentert som kommentar i `index.css` slik at ingen senere legger til unødvendig skaleringslogikk.
- Ikke gjort: punkt 3 i Fase C (focus-styling gjenbrukt fra designsystemet inn i faktiske komponenter) — det hører naturlig sammen med at ekte skjermer/komponenter bygges, ikke som isolert fundament-steg. Tas når første ekte skjerm bygges.

**Steg 5 — FERDIG (2026-08-12): FASE D, punkt 1–2 — Video-avspilling (abstraksjonslag)**
- ✅ Installert `hls.js` (for HLS-avspilling der plattformen ikke har native støtte — de fleste Tizen WebKit-builds og alle Chromium-baserte nettlesere brukt i dev)
- ✅ `src/core/player/types.ts` — plattformnøytralt `Player`-interface (`attach/load/play/pause/seekBy/setMuted/getState/subscribe/dispose`) + `PlayerState`/`PlayerError`-typer. Feature-kode skal aldri snakke direkte med `HTMLVideoElement`, `hls.js` eller Tizen sitt AVPlay — alt går via dette interfacet.
- ✅ `src/core/player/htmlVideoPlayer.ts` — `createHtmlVideoPlayer()`: HTML5 `<video>` + MSE-implementasjon, bruker `hls.js` for `.m3u8`-kilder når nettleseren ikke støtter HLS nativt
- ✅ `src/core/player/index.ts` — barrel-eksport
- Bevisst **ikke** gjort: Tizen AVPlay-implementasjon (native Samsung-API for bedre codec-/DRM-støtte). Kan legges til som en alternativ `Player`-implementasjon bak samme interface senere, når vi har en ekte enhet å teste DRM-behov mot — ren spekulativ kode uten det ville vært overengineering nå.
- Ikke gjort: selve avspillings-UI-en (fullscreen-overlay, kontroller, kildebytte) — det er skjermbygging (feature-arbeid), ikke fundament, og tas når Player-skjermen faktisk bygges.

Ikke gjort ennå: Fase E (pakking/signering/enhetstest), Fase F (sertifisering), samt selve skjerm-/feature-byggingen (App.tsx er fortsatt Vite-placeholder-innhold — Fase D punkt 3+ og Fase C punkt 3 (focus-styling i praksis) henger begge på at ekte skjermer bygges).

## 3b. Nåværende steg — hva er reelt igjen

Alt "fundament"-arbeid som kan gjøres uten en fysisk/emulert Tizen-enhet eller uten å begynne på faktiske skjermer er nå dekket (Fase A–D er komplette på abstraksjonsnivå). Det som gjenstår er i praksis to ulike typer arbeid, og de bør ikke blandes i samme økt:

1. **Feature-/skjermbygging** (erstatte `App.tsx`-placeholderen med ekte NINETY-skjermer — Home, Channels osv., jf. designsystem-dokumentet). Dette er potensielt stort og bør tas skjerm for skjerm i egne økter, ikke som "fundament".
2. **Enhets-/verktøyarbeid som krever manuell installasjon utenfor denne økten** (Fase E: installere Tizen Studio, generere sertifikat, koble til emulator/fysisk TV). Kan ikke gjøres autonomt her.

**Steg 6 — FERDIG (2026-08-12): Home-skjelett (replika av skjermbilde)**
- ✅ `src/features/navigation/TopNav.tsx` + `.css` — logo, 5 nav-punkter (Home/Matches/Live/Competitions/Channels) med grønn understrek på aktiv fane, fokusstyling, klokke/avatar til høyre. Bruker `useFocusable` fra `norigin-spatial-navigation`.
- ✅ `src/features/home/HomeScreen.tsx` + `.css` — sport-filter-piller, hero-seksjon (kamptittel, kickoff, venue, Watch Now-knapp med fokus-ring), Live Now-rad (4 fokuserbare kort), Tonight-rad (5 fokuserbare rader). Alt stylet fra `core/designsystem/tokens.css`.
- ✅ `src/data/mockHome.ts` — hardkodet mock-data (tilsvarer `FakeFootballDataRepository`-tanken fra `NINETY-build-plan.md` Fase 0.6, men foreløpig som ren datafil uten repository-abstraksjon — det kommer når domenelaget bygges)
- ✅ `src/App.tsx` skrevet om fra Vite-placeholder til `<TopNav /> + <HomeScreen />`
- ✅ Ryddet bort ubrukte Vite-mal-assets: `App.css`, `assets/react.svg`, `assets/vite.svg`, `assets/hero.png`, `public/icons.svg`, `public/favicon.svg`
- ✅ Verifisert: `npm run build:tizen` grønt, og `npm run dev` startet og bekreftet reachable på `http://localhost:5173/` (piltast-/Enter-navigasjon testbar i nettleser med Escape som Back-fallback)
- Bevisst **ikke** bygget ennå: Channels-skjermene (land-/kategori-/kanalliste + info-panel fra de andre skjermbildene du sendte), ekte stadionbilde, faktisk kobling til `core/player`/`core/platform` sin Back-stack i en flerskjerms-navigasjonsflyt (kun én skjerm finnes så langt, så Back har ingenting å gå tilbake til ennå)

**Steg 7 — FERDIG (2026-08-12): M3U-tilkobling + testspiller (deler av Fase 3 + reell bruk av Fase D-spillerlaget)**

Bruker ba spesifikt om å kunne teste `core/player` med en ekte M3U-playlist, så dette hoppet foran den opprinnelige "velg neste skjerm"-planen i punkt 3b under.

- ✅ `src/data/m3u/types.ts` — `M3uChannel { id, name, logo?, groupTitle?, url }`
- ✅ `src/data/m3u/parseM3u.ts` — minimal EXTM3U-parser (leser `#EXTINF`-attributter + navn, parer med URL-linjen som følger). Navnenormalisering (lowercase/strip HD-suffiks etc., jf. `NINETY-build-plan.md` Fase 3 pkt. 4) er **ikke** implementert ennå — det hører til kanal-matching-steget, ikke rå parsing.
- ✅ `src/features/setup/PlaylistSetupScreen.tsx` + `.css` — URL-felt + "Connect", og en fil-opplastingsknapp som reell fallback. **Viktig begrensning dokumentert i kode:** mange offentlige M3U-servere sender ikke CORS-headere, så direkte URL-fetch fra nettleseren kan feile av årsaker utenfor vår kontroll — fil-opplasting omgår dette helt og er den anbefalte veien for pålitelig testing.
- ✅ `src/features/player/ChannelPlayerScreen.tsx` + `.css` — kanalliste til venstre, `<video>`-element til høyre koblet til `core/player` sin `createHtmlVideoPlayer()`. Viser avspillerstatus (`idle/loading/playing/error`) live via `player.subscribe()`.
- ✅ `src/App.tsx` fått en midlertidig in-memory skjermbytter (`'home' | 'setup' | 'player'`) siden ekte routing ikke er bygget ennå — appen starter nå på Setup-skjermen. Dette er eksplisitt merket som midlertidig i kode.
- ✅ **Sidefunn, fikset:** `hls.js` ble bundlet inn i hoved-JS-en (762 KB) siden den nå faktisk brukes og ikke lenger tree-shakes bort. Byttet til dynamisk `import('hls.js')` inne i `load()` slik at den kun lastes når en `.m3u8`-kilde faktisk spilles av og plattformen mangler native HLS-støtte — hovedbunten er nå ~255 KB, hls.js egen chunk ~255 KB (gzippet mindre) lastes on-demand.
- ✅ Verifisert: `npm run build:tizen` grønt, dev-server fortsatt reachable på `http://localhost:5173/`

⚠️ **For bruker å teste selv:** Åpne `http://localhost:5173/`, lim inn en M3U-URL (eller bruk "M3U File…" hvis URL-en feiler pga. CORS) → trykk Connect → kanalliste + spiller vises. Reell kringkastings-DRM/enkelte strømtyper kan fortsatt kreve Tizen AVPlay (ikke bygget ennå, se Fase D-notat over) — dette er en HTML5/hls.js-testspiller, ikke den ferdige NINETY-spiller-UI-en fra byggeplanen (Fase 5).

**Steg 8 — FERDIG (2026-08-12): Ordentlig IPTV-datalag (Xtream Codes API + produksjons-CORS)**

Bruker presiserte at dette ikke lenger er en test, men den ordentlige versjonen — research gjort før implementasjon (se kildehenvisninger i chat-loggen for denne økten).

**Funn 1 — Xtream Codes:** URL-en brukeren testet med (`get.php?username=...&password=...&type=m3u_plus&output=ts`) er signaturen til **Xtream Codes/Xtream UI**, det klart vanligste IPTV-panel-systemet. Disse eksponerer et JSON-API (`player_api.php`) med kategorier, live-streams, VOD, serier og EPG — mye rikere enn å parse rå M3U-tekst. Ordentlige IPTV-klienter (TiviMate, IPTV Smarters) bruker dette API-et, ikke bare M3U.

**Funn 2 — CORS er et dev-only-problem, ikke et produksjonsproblem:** Tizen (og alle W3C Widget-baserte pakkede apper, samme mekanisme som Cordova/PhoneGap) bruker WARP-sikkerhetsmodellen. `<access origin="*" subdomains="true"/>` + internet-privilegiet i `config.xml` gir selve widgeten tillatelse til cross-origin XHR/fetch **uten at serveren må sende CORS-headere** — pakket widget-innhold er ikke underlagt samme-origin-policyen en nettleserfane håndhever. CORS-feilen vi så var **kun** fordi vi tester i en vanlig nettleser via `vite dev`, som ignorerer `config.xml` fullstendig.

Bygget:
- ✅ `src/data/channel.ts` — delt `Channel`-type (`id/name/logo?/groupTitle?/url`) som både M3U- og Xtream-kilder normaliserer til, slik at resten av appen (kanalliste, spiller) er kildeagnostisk
- ✅ `src/data/xtream/types.ts` — `XtreamCredentials`, `XtreamLiveCategory`, `XtreamLiveStream`, `XtreamAccountInfo`
- ✅ `src/data/xtream/xtreamClient.ts` — `parseXtreamPlaylistUrl()` (gjenkjenner `get.php`-URL-mønsteret og trekker ut server/brukernavn/passord), `getLiveCategories()`, `getLiveStreams()`, `buildLiveStreamUrl()`, `verifyAccount()`
- ✅ `src/data/xtream/toChannels.ts` — mapper Xtream live-streams + kategorier til delt `Channel`-format
- ✅ `src/core/net/devCorsProxy.ts` — `fetchWithDevCorsFallback()` flyttet hit fra Setup-skjermen og gjenbrukt av `xtreamClient`, tydelig kommentert som **dev-only testing-hjelper**, ikke produksjonslogikk (er isolert i egen fil nettopp for å gjøre det opplagt at den kan slettes når vi tester mot ekte Tizen-bygg)
- ✅ `src/features/setup/PlaylistSetupScreen.tsx` oppdatert: `loadFromUrl()` prøver Xtream-API først (gjenkjent via URL-mønster), faller tilbake til rå M3U-parsing for andre kilder
- ✅ `config.xml` oppdatert med `<tizen:privilege internet>` + `<access origin="*" subdomains="true"/>` og forklarende kommentar — dette er den ordentlige produksjonsløsningen på CORS-problemet
- ✅ Ryddet: slettet `src/data/m3u/types.ts` (erstattet av delt `Channel`-type), oppdatert alle referanser i `ChannelPlayerScreen.tsx` og `App.tsx`
- ✅ Verifisert: `npm run build:tizen` grønt, URL-gjenkjenningsregex testet mot brukerens faktiske URL og bekreftet riktig
- Ikke gjort: kategori-gruppert kanalliste-UI (Xtream-dataene har nå `groupTitle` per kanal og er klare for det, men selve den kategoriserte navigasjons-UI-en hører til Channels-skjermbygging, se punkt 3b), VOD/serier/EPG-endepunkter (kun live-streams implementert foreløpig), lagring av tilkoblede spillelister (ingen persistens-lag ennå — det er Fase 3 pkt. 1 i `NINETY-build-plan.md`, Room-ekvivalent)

**Steg 9 — FERDIG (2026-08-12): Fikset faktisk avspilling + bygget Channels-skjermene pixel-nært skjermbildene**

Bruker rapporterte at kanaler lastet inn, men ingenting spilte av — og ba om at Channels-skjermene bygges identisk med de tre skjermbildene som ble sendt (Channels Design System-oversikt, Sports Channels-detaljvisning, Norway-kategoriliste, Channels-landliste).

**Del A — avspillingsfiksen:**
- Root cause: `hls.js` henter både manifest og hvert enkelt videosegment via JS (`fetch`/XHR) — i motsetning til en vanlig `<video src>` er dette reelt underlagt CORS, så det samme problemet som blokkerte spillelisteinnlasting rammet nå avspillingen også.
- ✅ Utvidet dev-proxyen i `vite.config.ts` med en HLS-bevisst rute (`/dev-proxy/hls`): når responsen er et `.m3u8`-manifest, skrives hver segment-URI i manifestet om til å gå via samme proxy (rekursivt), slik at hele avspillingskjeden — ikke bare første forespørsel — fungerer i nettleseren.
- ✅ `src/core/net/devCorsProxy.ts` fikk `toDevHlsProxyUrl()`; `htmlVideoPlayer.ts` bruker den for `hls.loadSource()` kun når `import.meta.env.DEV` — ingen endring i produksjonsoppførsel (Tizen løser dette via WARP `<access>`-policyen fra Steg 8, ikke via proxy).
- ✅ Build + dev-server verifisert grønt etter restart (påkrevd siden `vite.config.ts` endret seg)

**Del B — Channels-skjermer, bygget i `src/features/channels/`:**
- ✅ `ListRow.tsx`/`.css` — delt radkomponent for kategori-lister (designsystemets konsistensregel #1: "Country and Category use the same row component")
- ✅ `SearchField.tsx`/`.css`, `QuickAccess.tsx`/`.css`, `Breadcrumb.tsx`/`.css` — gjenbrukbare komponenter identisk med skjermbildene
- ✅ `categoryIcon.ts` — nøkkelord-basert ikonvalg for kategorier (⚽ Sports, 📰 News, osv., med generisk fallback)
- ✅ `ChannelsRootScreen.tsx`/`.css` — tittel, søk, Quick Access (3 kort), "Browse by Category" med **ekte** kategoridata (og -antall) fra den tilkoblede spillelisten, søkbar
- ✅ `CategoryChannelsScreen.tsx`/`.css` — delt skjerm (62/38) med kanalliste til venstre (fast logo-slot 80px, akkurat som designsystemet spesifiserer) og info-panel til høyre (logo, navn, Watch/Add to Favorites-CTA)
- ✅ `App.tsx` fikk full skjermflyt: Setup → Channels root (kategorier) → Kategori (kanalliste + info-panel) → Watch → Player
- ⚠️ **Bevisst avvik fra skjermbildene, dokumentert i kode:** Country-laget (Norway/UK/Sweden-listen) er **ikke** bygget, fordi ekte Xtream/M3U-spillelistedata ikke har pålitelig per-kanal landsmetadata — å finne opp fiktive land ville gitt et falskt inntrykk av hva appen faktisk vet om brukerens spilleliste. Kun kategori-nivået (som er ekte data) er bygget.
- ⚠️ **Bevisst avvik #2:** Info-panelets EPG/"Now playing"/Sources-seksjoner fra skjermbildet er **ikke** fylt med oppdiktet data (som "Liverpool vs Arsenal 62'") siden Xtream `get_short_epg`-endepunktet ikke er implementert ennå. Viser i stedet en ærlig, dempet tekst om at EPG/kilde-data ikke er koblet til ennå.
- ✅ Verifisert: `npm run build:tizen` grønt, dev-server oppe

**Steg 10 — FERDIG (2026-08-12): Ordentlig avspillingsfiks (mpegts.js) + Country-lag med ekte data**

Bruker rapporterte at avspilling fortsatt ikke fungerte, og opplyste at kategorinavnene har et landskode-prefiks (f.eks. "NO" = Norge) — det løste Steg 9 sitt bevisste utelatte Country-lag.

**Avspillingsfiks (root cause #2):**
- Forrige fiks (HLS-proxy) løste selve CORS-en, men avdekket neste lag: Xtream-panelers **standard** live-endepunkt er rå MPEG-TS (`.ts`), ikke HLS (`.m3u8`) — mange paneler tilbyr ikke `.m3u8` i det hele tatt. Chrome (og de fleste WebKit-varianter) kan ikke dekode en rå TS-beholder nativt i `<video>`.
- ✅ Installert `mpegts.js` (bransjestandard for nettleser-avspilling av rå MPEG-TS IPTV-strømmer via MSE) og lagt inn som eget lastesport i `htmlVideoPlayer.ts` ved siden av hls.js-sporet — `.ts`-kilder → mpegts.js, `.m3u8`-kilder → hls.js, begge dynamisk importert
- ✅ `xtreamClient.buildLiveStreamUrl()` default endret fra `.m3u8` til `.ts`
- ✅ **Fant og fikset en alvorlig bug i dev-proxyen samtidig:** binærgrenen bufret hele responsen via `arrayBuffer()` før den ble sendt videre — for en finite HLS-segment er det greit, men en direkte `.ts`-livestrøm er en kontinuerlig, i praksis uendelig respons, så bufring ville aldri fullføre og aldri levere noe til nettleseren. Byttet til ekte streaming via `Readable.fromWeb(...).pipe(res)`.

**Country-lag (bygget på ekte data denne gangen):**
- ✅ `src/data/countryCodes.ts` — kuratert kodetabell (landskode → navn) + `flagEmoji()`-generator fra 2-bokstavskode
- ✅ `src/features/channels/parseCategory.ts` — gjenkjenner prefiks-mønsteret (`NO| Sports`, `UK - News`, `SE: Kids` osv.), strips det kun når koden faktisk finnes i tabellen (unngår feiltolkning av tilfeldige store bokstaver som landskode)
- ✅ `ChannelsRootScreen.tsx` bygget om til å vise **Country**-listen (flagg + landsnavn + antall), gruppert fra ekte kategoridata
- ✅ `CountryCategoriesScreen.tsx` (ny) — kategori-listen **innenfor** valgt land, med brødsmulesti, gjenbruker `ListRow`
- ✅ `App.tsx` fikk full 4-stegs flyt: Setup → Country → Category → Kanalliste+info-panel → Player
- ✅ Verifisert: `npm run build:tizen` grønt (mpegts.js splittes ut som egen on-demand chunk, akkurat som hls.js), dev-server restartet og oppe

**Steg 11 — FERDIG (2026-08-12): Ekte flaggbilder + source-/kvalitetsvariant-sammenslåing**

**Del A — ekte flagg:** Kopierte SVG-flagg fra `country-flag-icons`-pakken inn i `public/flags/{ISO-kode}.svg` (44 land, selvhostet — ingen CDN, funker offline på TV). `countryCodes.ts` fikk `flagSrc()` i stedet for emoji-generator; `ChannelsRootScreen` rendrer nå `<img>`.

**Del B — kvalitetsvariant-sammenslåing (undersøkt og testet mot brukerens egne eksempler, ikke gjettet blindt):**
- ✅ `src/data/normalize.ts` — delt `QUALITY_TAGS`-liste + `stripEdgeTags()`, `extractQualityTag()`, `normalizeCategoryLabel()`, `normalizeChannelName()`. **PPV er bevisst utelatt fra listen** — den skal forbli egen kategori, ikke slås sammen, akkurat som spesifisert.
- ⚠️ **Falsk-positiv funnet og fikset underveis:** Første forsøk inkluderte fristående `GOLD` og `PREMIUM` i taglisten (utledet fra vanlige IPTV-konvensjoner utover det brukeren eksplisitt nevnte). Testet mot ekte kanalnavn fra brukerens eget skjermbilde ("TV 2 Sport **Premium**") og et vanlig case ("ITV **Gold**") — begge ville blitt feilaktig kuttet. Fjernet begge fra listen; beholder kun de eksplisitt nevnte kombinasjonene (`GOLD RAW`, `ULTRA RAW GOLD`) og trygge tekniske koder (`4K`, `SD`, `HEVC`, `H264`, `H265`) i tillegg til `VIP`/`RAW`/`HD`/`FHD`/`UHD`.
- ✅ Verifisert med `npx tsx` direkte mot brukerens eksakte eksempel: `UK TNT SPORTS 1 RAW/UHD/FHD/HD` → alle fire kollapser korrekt til `TNT SPORTS 1`, med landskode `UK` også fjernet fra kanalnavnet (ny fiks — country-code-stripping fantes fra før kun for kategorier, ikke kanaler)
- ✅ **Datamodell endret:** `Channel` har nå `sources: ChannelSource[]` (`{label, url}`) i stedet for enkelt `url` — `RawChannel` (ny type) representerer én linje fra kilden før sammenslåing
- ✅ `src/features/channels/mergeChannels.ts` — `mergeChannelSources(raw: RawChannel[]): Channel[]`, grupperer på land+sammenslått-kategori+kanonisk-kanalnavn
- ✅ `parseCategory.ts` fikk `mergedLabel`-felt (kategori med kvalitetstagger fjernet) — `CountryCategoriesScreen` grupperer nå på dette i stedet for rå kategori-streng, så VIP/RAW/GOLD-varianter av samme kategori vises som ÉN rad
- ✅ **Sources-seksjonen i info-panelet er nå ekte** (var placeholder-tekst i Steg 9): viser faktiske kvalitetsvarianter som klikkbare piller, valgt kilde spilles av. Samme source-bytter lagt til i selve spiller-skjermen.
- ✅ Kanal-logo: allerede fanget fra `tvg-logo` (M3U) / `stream_icon` (Xtream) siden Steg 8/9 — bekreftet at det vises i kanalliste og info-panel
- ✅ `PlaylistSetupScreen` kjører nå `mergeChannelSources()` rett etter parsing, før dataene lagres i state
- ✅ Build grønt, dev-server oppe

**Steg 12 — FERDIG (2026-08-12): To rot-årsaker funnet for hvorfor sammenslåingen ikke virket i praksis**

Bruker viste skjermbilder av faktisk kjørende app: kategorier som "NORWAY ⱽᴵᴾ", "NORWAY ᴳᴼᴸᴰ ᴿᴬᵂ" osv. ble IKKE slått sammen, og kanaler beholdt "NO:"-prefiks. Undersøkte dataen i skjermbildene nøye i stedet for å anta:

**Rotårsak 1 — landsformat stemte ikke med antagelsen:** Brukerens data bruker **fullt stavet landsnavn** ("NORWAY") som prefiks, ikke en 2-3-bokstavs kode ("NO|") slik Steg 9/11 antok. `parseCategory` gjenkjente derfor aldri landet i det hele tatt for kategorier stavet slik.
- ✅ `countryCodes.ts` fikk `matchLeadingCountry()` som prøver **både** fullt landsnavn og kode, mot en Unicode-foldet versjon av teksten
- Samtidig: kanal-prefikset viste seg å bruke kolon (`NO: TV2 ...`), som den gamle `stripLeadingCountryCode`-regexen (kun mellomrom) ikke matchet — løst av samme `matchLeadingCountry()`-funksjon som nå brukes konsekvent for både kategori- og kanalnavn

**Rotårsak 2 — kvalitetstaggene var skrevet med Unicode-«superscript»-bokstaver, ikke ASCII:** `ⱽᴵᴾ`, `ᴴᴰ`, `ᴿᴬᵂ`, `ᴳᴼᴸᴰ` osv. er ikke bokstavene V/I/P/H/D — det er egne Unicode-kodepunkter fra "Phonetic Extensions"/"Superscripts"-blokkene som mange IPTV-paneler bruker for visuell stil. Almindelig ASCII-regex (`\bVIP\b`) traff aldri disse.
- ✅ `src/data/fancyUnicode.ts` (ny) — `foldForMatching()` mapper disse tegnene 1:1 tilbake til vanlige ASCII-bokstaver (lengdebevarende, så indekser i original-strengen forblir gyldige), brukt av all tag-/landsgjenkjenning
- ⚠️ **Bug funnet og fikset underveis:** Første `stripDecorativeEdges()`-implementasjon (for å fjerne dekorative `#####`-rammer sett i data) brukte "alt som ikke er A-Za-z0-9" som dekorativt — det kuttet bort **både** de fancy Unicode-tegnene FØR de fikk sjansen til å foldes, OG ekte norske bokstaver (Æ/Ø/Å) i ekte kanalnavn som "VÆRKANALEN". Byttet til en presis liste over faktiske dekorasjonstegn (`# = * ~ • · ▪`) i stedet for en for bred eksklusjon.
- ✅ Verifisert med `npx tsx` direkte mot rekonstruerte eksempler fra skjermbildene: alle `NORWAY [tag]`-varianter slår seg nå sammen til én generell "Norway"-kategori (`mergedLabel: ""`, vist som "General" i UI); `TV2 PLAY PPV`/`TV2 PLAY PPV ⱽᴵᴾ` slår seg sammen (PPV forblir egen, urørt); alle `NO: TV2 [tag] ⱽᴵᴾ`-kanalvarianter kollapser korrekt til kanonisk `TV2`; `VÆRKANALEN` forblir urørt.
- ⚠️ **Kjent, akseptert begrensning:** `"NORWAY ULTRA RAW DOLBY AUDIO"` slår seg ikke helt sammen med de andre siden `RAW` står midt i strengen (ikke i kant) — stripping skjer bevisst kun fra kantene for å unngå å ødelegge ekte tekst midt i navn. Sjelden case, ett enkelt gjenstående avvik.
- ✅ `App.tsx` fikk en liten men reell bug fikset samtidig: tom `mergedLabel` (`""`) er en gyldig valgt kategori (den generelle landsbøtta), men ble tidligere behandlet som "ingenting valgt" pga. en truthy-sjekk (`mergedCategory &&`) — byttet til eksplisitt `!== null`-sjekk
- ✅ Build grønt, dev-server oppe, ingen restart nødvendig (ingen `vite.config.ts`-endringer denne runden)

**Steg 13 — FERDIG (2026-08-12): Navigasjonsforenkling, filter, gruppering, forhåndsvisning, tastatur-Back**

Stor, sammensatt bestilling — seks separate ting, alle gjennomført:

1. ✅ **Kosmetisk Unicode-fiks:** `fancyUnicode.ts` fikk `foldForDisplay()` (case-bevarende, i motsetning til `foldForMatching()` som brukes internt til sammenligning) — brukes nå som siste steg i `normalizeCategoryLabel`/`normalizeChannelName`, slik at ord som ikke er en gjenkjent kvalitetstag (f.eks. "super" i "VIAPLAY PPV ˢᵘᵖᵉʳ") likevel vises som normal lesbar tekst i stedet for tiny superscript-glyphs. Dette var trolig det du så som gjensto ("kategorier med unicorn/unicode").
2. ✅ **Kategori fjernet fra kanal-browsing:** Slettet `CountryCategoriesScreen.tsx` og hele det mellomliggende navigasjonssteget. Flyten er nå kun **Land → Kanaler** (`ChannelsRootScreen` → `CountryChannelsScreen`, ny fil som erstatter den gamle `CategoryChannelsScreen`).
3. ✅ **To grupperinger inne i kanallisten:** `CountryChannelsScreen` deler nå kanalene i **"Regular"** (øverst) og **"Pay-Per-View"** (nederst, med kort forklarende undertekst: *"Paid one-off events, billed separately from your regular channels."*). Gjenkjennelse via `isPpvCategory()` i `parseCategory.ts` (sjekker om PPV-ordet — som aldri strippes — finnes i kategoriens `mergedLabel`).
4. ✅ **Filter-popup (kun visuelt, sletter ingenting):** `FilterPopup.tsx` — to kolonner (Countries/Categories) med av/på-avkrysning. Eksplisitt tekst i UI-en: *"This only affects what you see here — nothing is removed from your playlist."* Tilstand (`hiddenCountries`/`hiddenCategories`) løftet til `App.tsx`, ikke persistert (nullstilles ved reload — persistens er et eget, senere steg). Åpnes via ny "⚙ Filter"-knapp ved siden av søkefeltet på Country-skjermen. Gjelder både på land (skjuler rad i landlisten) og kategorier (skjuler kanaler med den kategorien fra Regular/PPV-listene).
5. ✅ **Alle ikoner fjernet fra kategori:** `categoryIcon.ts` slettet (var kun brukt av den nå fjernede kategori-skjermen). Landflagg (et annet konsept — landikon, ikke kategoriikon) er beholdt i landlisten som avtalt tidligere.
6. ✅ **Forhåndsvisnings-miniplayer:** `CountryChannelsScreen` sitt info-panel har nå en `PreviewPlayer`-komponent øverst — en egen, liten `core/player`-instans (samme HTML5/hls.js/mpegts.js-lag som hovedspilleren) som automatisk laster og spiller av den valgte kanalens aktive source mens du browser, muted. Egen instans fra fullskjerm-spilleren, ryddes opp når skjermen forlates.
7. ✅ **Tastatur/fjernkontroll + tilbakeknapper:** Piltaster/Enter fungerte allerede via `norigin-spatial-navigation`s standard `keydown`-håndtering (ingen endring nødvendig). Det som **manglet** var at `core/platform`-laget fra Fase B (bygget i Steg 3, men aldri koblet til noen skjerm!) faktisk ble brukt — `useBackHandler()` er nå kablet inn i `CountryChannelsScreen` og `ChannelPlayerScreen`, slik at Escape (dev-fallback for Tizen sin Back=10009) navigerer tilbake ett nivå. Synlige "← Back"-knapper lagt til/beholdt på begge skjermer i tillegg (ikke bare tastatur).

**Bieffekt av navigasjonsforenklingen:** Siden kategori-skjermen er fjernet, mistet spiller-skjermens sidepanel automatisk sin "bla mellom kanaler i samme kategori"-liste — gjenopprettet ved å beregne søsken-kanaler (samme land+kategori som den som spilles) i `App.tsx` og sende dem inn i `ChannelPlayerScreen` sammen med hovedkanalen.

Build grønt, dev-server oppe (ingen restart nødvendig — ingen `vite.config.ts`-endringer denne runden).

**Steg 14 — FERDIG (2026-08-12): Gjenopprettet Land→Kategori→Kanaler, PPV-presisering, og piltast-navigasjon fikset**

Bruker korrigerte Steg 13: kategori-nivået skulle IKKE fjernes — det skal fortsatt være Country → Category → Channels. Presiserte også PPV-forklaringen, og meldte at piltastene ikke virket i nettleseren.

- ✅ `CountryCategoriesScreen.tsx` gjenopprettet (Land → Kategori-liste), men nå med **Vanlig/PPV-gruppering flyttet hit** (til kategorinivå, i stedet for kanalnivå som i Steg 13) — kategorier vises i to seksjoner, "Pay-Per-View" nederst med kort forklaring
- ✅ **PPV-forklaring presisert** etter tilbakemelding: dette er enkeltstående engangs-hendelser, ikke et eget betalt nivå — "Single one-off events, kept separate from your regular channels. Nothing costs extra here." (byttet ut den forrige, feilaktige "billed separately"-teksten)
- ✅ `CategoryChannelsScreen.tsx` gjenopprettet (Kategori → Kanalliste + info-panel), nå ren flat liste for én valgt kategori (siden Vanlig/PPV-splitten skjedde ett steg tidligere) — beholder forhåndsvisnings-miniplayer, source-piller, Watch/Favorites-CTA, Back-knapp/-handler fra Steg 13
- ✅ `ListRow` fikk `icon` som valgfri prop (kategorier viser fortsatt ingen ikon, land viser fortsatt flagg)
- ✅ `App.tsx` fikk tilbake det 4-delte skjermforløpet: `channels-root` (land) → `channels-category` (kategori) → `channels-list` (kanaler) → `player`

**Piltast-navigasjon i Chrome — rotårsak funnet:** `@noriginmedia/norigin-spatial-navigation` setter **aldri** fokus automatisk selv — bibliotekets egen README sier eksplisitt at appen selv må «set the initial focus». Uten det har piltastene ingenting å navigere fra, og gjør ingenting synlig. Dette var aldri koblet til i noen tidligere steg.
- ✅ `App.tsx` kaller nå `setFocus(ROOT_FOCUS_KEY)` i en `useEffect` som kjører på hvert skjermbytte (det fokuserbare tre-et byttes helt ut mellom skjermer, så dette må gjøres på nytt hver gang, ikke bare én gang ved oppstart)
- ⚠️ **Svar til bruker om hvordan bruke piltaster i Chrome:** Etter denne fiksen skal Pil opp/ned/venstre/høyre flytte fokus (grønn kant) mellom rader/knapper, og **Enter** velger. **Escape** fungerer som Tilbake (dev-fallback for Tizen sin fjernkontroll-Back-knapp). Klikk et sted i selve siden (ikke adresselinjen) først, slik at nettleservinduet har fokus, ellers går tastetrykk til Chrome selv.
- ✅ Build grønt, dev-server oppe, ingen restart nødvendig

**Steg 15 — FERDIG (2026-08-12): PPV-forklaring presisert på nytt**

Bruker forklarte hva PPV faktisk betyr her: ikke et betalt nivå, men enkeltstående sendinger av spesifikke hendelser (f.eks. én kamp) som kun finnes som egen strøm — typisk når en kringkaster ikke sender kampen på noen av sine faste TV-kanaler, kun som en frittstående sending på strømmetjenesten sin (f.eks. kun på TV2 Play, ikke på en TV2-kanal).

- ✅ `PPV_EXPLAINER` i `CountryCategoriesScreen.tsx` skrevet om: *"A one-off stream for a single event (e.g. one match) — not a regular TV channel. Nothing costs extra here."*
- ✅ Build grønt

**Steg 16 — FERDIG (2026-08-12): Fjernet pris-nevning, fjernet forhåndsvisningsvideo, implementerte ekte EPG**

Bruker bekreftet at avspilling nå fungerer (skjermbilde viste live fotballkamp i forhåndsvisningen). Tre oppfølgingspunkter:

1. ✅ **Pris fjernet fra PPV-tekst:** Bruker presiserte at alt allerede er betalt for, ingenting koster ekstra — fjernet "Nothing costs extra here" helt fra `PPV_EXPLAINER` i stedet for å nevne pris i det hele tatt.
2. ✅ **Forhåndsvisningsvideoen fjernet igjen:** Tok for mye plass. Fjernet `PreviewPlayer`-komponenten (lagt til i Steg 13) fra info-panelet, samt kanal-logoen — info-panelet viser nå kun kanalnavn, kilder, EPG og handlingsknapper.
3. ✅ **EPG undersøkt og implementert (ikke bare research):** Xtream sitt `get_short_epg`-endepunkt er godt dokumentert og vi hadde allerede Xtream-koblingen — vurderte det som verdt å bygge med en gang fremfor bare å rapportere funn.
   - ✅ `xtreamClient.ts` fikk `getShortEpg(creds, streamId, limit)` — henter neste programmer for en kanal, med forsvarlig base64-dekoding (paneler er uenige om tittel/beskrivelse er base64-kodet eller rentekst; sjekker om det faktisk ser ut som gyldig base64 før dekoding, i stedet for å anta)
   - ✅ `extractStreamId.ts` — vårt sammenslåtte `Channel`-format lagrer ikke Xtream sin rå `stream_id`, men den er gjenopprettbar fra avspillings-URL-en (`buildLiveStreamUrl()` former den alltid som `.../live/user/pass/{streamId}.ext`)
   - ✅ `PlaylistSetupScreen.onLoaded` sender nå også med `XtreamCredentials | null` (null for rene M3U-kilder) videre til `App.tsx` → `CategoryChannelsScreen`, siden EPG kun finnes via Xtream sitt JSON-API
   - ✅ Info-panelet viser nå **"NOW"**-badge + gjeldende program, og en "Up Next"-liste med kommende programmer (tid + tittel), eller en ærlig melding når EPG ikke er tilgjengelig (ren M3U-kilde, eller panelet mangler data for akkurat den kanalen)
   - ⚠️ **Kjent begrensning:** Kun implementert for Xtream-kilder. Ren M3U + separat XMLTV-fil (nevnt som eget alternativ i det opprinnelige oppsett-skjermbildet: "EPG (XMLTV)") er **ikke** bygget — det krever å parse en helt separat XML-fil og matche den mot kanaler via `tvg-id`, en annen jobb enn Xtream-integrasjonen. Eget steg ved behov.
   - ✅ Build grønt, dev-server oppe

**Steg 17 — FERDIG (2026-08-12): To bugfikser fra brukertesting**

1. ✅ **Forhåndsvisningsvideo gjenopprettet:** Steg 16 fjernet den ved en misforståelse ("kun kanalnavn og source" ble tolket som "fjern video også") — bruker presiserte at kun logoen skulle bort. `PreviewPlayer` lagt tilbake i `CategoryChannelsScreen.tsx`, logo fortsatt fjernet.
2. ✅ **EPG-tegnsett fikset (UTF-8-feildekoding):** `atob()` gir en "binary string" (én JS-char per rå byte) — siden Xtream-teksten er UTF-8-kodet, må disse bytene tolkes som UTF-8 (via `TextDecoder`), ikke leses direkte som tegn. Uten det ble f.eks. "Tegnspråknytt" til "TegnsprÅ¥knytt" — akkurat feilen i skjermbildet. Verifisert med en direkte Node-test: gammel kode reproduserte nøyaktig samme feil, ny kode gir korrekt resultat.
- ✅ Build grønt, dev-server oppe

**Steg 18 — FERDIG (2026-08-12): Info-panel-layout fikset (ingen scroll)**

Bruker rapporterte at info-panel-boksen (forhåndsvisning + EPG + kilder + knapper) var for høy og krevde scroll, og at kanallisten var for kort/ikke fylte tilgjengelig høyde.

- ✅ `.category-channels` fikk fast høyde (`calc(1080px - 84px)`, samme mønster som spiller-skjermen) i stedet for å vokse fritt og skyve hele siden til å scrolle
- ✅ `.split` (kanalliste + info-panel) fikk `flex: 1; min-height: 0` slik at begge barna fyller resten av høyden og scroller **internt** i stedet for at siden scroller
- ✅ `.ch-list` fylte nå 100% høyde (fjernet den harde `max-height: 600px`-begrensningen som gjorde listen kortere enn nødvendig)
- ✅ `.info-panel` fikk `height: 100%` + `overflow-y: auto` (intern scroll som siste utvei, ikke sideutvei), redusert padding/gap
- ✅ `.preview-video` fikk `max-height: 200px` slik at den ikke alene dominerer plassen
- ✅ Knappehøyder redusert noe (64px → 52px) for å få mer til å passe uten trengsel
- ✅ Build grønt, dev-server oppe

**Steg 19 — FERDIG (2026-08-12): Favoritter for kanaler og kategorier, pinnet øverst**

- ✅ `src/features/channels/favorites.ts` — `categoryFavoriteKey(country, mergedLabel)`, siden samme kategorinavn kan finnes under flere land (nøkkelen må inkludere landet for å være unik)
- ✅ `ListRow.tsx` fikk valgfri stjerne-toggle (`favorited`/`onToggleFavorite`) — brukt av kategori-rader (ikke land-rader, kun kanaler+kategorier som bedt om). Dette er en funksjonell kontroll, ikke dekorativt kategori-ikon, så det er ikke i konflikt med "fjern alle ikoner på category" fra tidligere.
- ✅ `CountryCategoriesScreen.tsx` — favoriserte kategorier sorteres øverst i sin seksjon (Regular/PPV hver for seg), deretter etter antall kanaler som før
- ✅ `CategoryChannelsScreen.tsx` — kanal-rader fikk samme stjerne-toggle; favoriserte kanaler sorteres øverst i kanallisten. Den eksisterende (tidligere dekorative) "Add to Favorites"-knappen i info-panelet er nå faktisk koblet til og reflekterer status (★ Favorited / ☆ Add to Favorites)
- ✅ `App.tsx` fikk `favoriteChannels`/`favoriteCategories` state (samme mønster og samme ikke-persistens-forbehold som filter-state fra Steg 13 — nullstilles ved reload, persistens er eget senere steg) + delt `toggleInSet`-hjelpefunksjon (omdøpt fra `toggleHidden` siden den nå brukes til begge formål)
- ✅ Build grønt, dev-server oppe

**Steg 20 — FERDIG (2026-08-13): Ettkolonne cascade-browser (Country → Category → Channel → Preview) + Favorites/Recently Watched-skjermer**

Gjennomført i en økt som ikke ble loggført fortløpende — rekonstruert her fra kode ved starten av neste økt, siden denne statusfilen ikke ble oppdatert underveis. **Leksjon: denne filen må oppdateres etter hvert steg i samme økt det gjøres i, ikke rekonstrueres i ettertid.**

- ✅ `src/features/channels/BrowseCascadeScreen.tsx` (ny, 25 KB) — erstatter hele den gamle skjerm-per-nivå-flyten (`ChannelsRootScreen` → `CountryCategoriesScreen` → `CategoryChannelsScreen`) med **én skjerm** der Country/Category/Channel/Preview vises som kolonner side ved side. Kolonner **kollapser ikke** når man går tilbake — alle forblir synlige, kolonnebredder justeres etter hvor mange som er i spill. Fire tilstander: (1) land+kategori valgt, ingen kanaler enda, (2) +kanalkolonne (ingen valgt), (3) +forhåndsvisning når en kanal faktisk velges. `CascadeLevel`-typen (`'country' | 'category' | 'channel' | 'preview'`) eksportert og løftet opp i `App.tsx` sin state (sammen med valgt land/kategori/kanal) slik at drill-down-posisjonen overlever en tur til fullskjerm-spilleren og tilbake, i stedet for å nullstilles ved remount.
- ✅ `src/features/channels/CountryCategoriesScreen.tsx` slettet — funksjonalitet absorbert inn i cascade-skjermen.
- ✅ `src/features/channels/CategoryChannelsScreen.tsx` generalisert: gjenbruker nå `ChannelRow`/`PreviewPlayer` (eksportert derfra og importert av `BrowseCascadeScreen`) og fikk `title`/`breadcrumb`/`emptyMessage`-props slik at samme komponent kan vise en vilkårlig kanalliste — ikke bare "kategori-innhold" — brukt av de to nye skjermene under.
- ✅ Nye skjermer **Favorites** og **Recently Watched**, begge rutet via `App.tsx`s `Screen`-union (`'channels-favorites' | 'channels-recent'`), begge gjenbruker `CategoryChannelsScreen` med ferdig-filtrert kanalliste (`favoriteChannelsList` / `recentChannelsList`, begge `useMemo` i `App.tsx`) og en tom-tilstand-melding.
- ✅ `App.tsx` fikk `recentlyWatched: string[]`-state (kanal-ID-er, nyeste først, avgrenset til `RECENTLY_WATCHED_LIMIT = 30`, deduplisert via `recordWatched()`), kalt fra en ny felles `watchChannel()`-hjelpefunksjon som også setter `playerReturnScreen` — slik at spillerens Back-knapp returnerer til **riktig** opprinnelsesskjerm (cascade-browser, Favorites, eller Recently Watched), ikke alltid samme sted.
- ✅ `src/features/channels/favorites.ts` sin `categoryFavoriteKey` gjenbrukt uendret; `hiddenCategories` er fortsatt komposittnøkkel per land+kategori.
- ⚠️ **Fokus-race funnet og løst:** `App.tsx`s generelle `useEffect` som kaller `setFocus(ROOT_FOCUS_KEY)` på hvert skjermbytte måtte eksplisitt hoppe over `'browse-cascade'` — den skjermen styrer sitt eget fokus per kolonne (gjenopprettes til riktig kolonne avhengig av `level`), og siden React kjører child-effekter før parent-effekter ville den brede ROOT-fokuseringen ellers alltid vunnet løpet og snappet fokus tilbake til Countries-kolonnen uansett hvor brukeren faktisk var.
- ⚠️ Søkefeltet/verktøylinjen (Filter/Recently Watched/Favorites-knappene) ligger geometrisk til høyre og overlapper ikke horisontalt med den smale Countries-kolonnen, så opp/ned-navigasjon inn/ut av den raden er koblet eksplisitt i stedet for å stole på ren geometri-basert spatial-nav.
- ✅ `npm run build:tizen` verifisert grønt i etterkant (kjørt ved rekonstruksjon av dette steget) — ingen build-brudd fra Steg 20-endringene.

**Steg 21 — FERDIG (2026-08-13): Home-skjermen koblet til ekte fixture-/logo-data (TheSportsDB, gratis)**

Bruker ba om å erstatte Home-skjermens hardkodede mock med ekte data (kamper, kanallogoer, bakgrunnsbilder), og fortsette autonomt over natten. Gjorde research først (se punktet over om API-alternativer), verifiserte alt direkte mot den ekte API-en før noe ble bygget — ikke antatt fra dokumentasjon.

**Valgt kilde:** [TheSportsDB](https://www.thesportsdb.com/) sin gratis/community-API, med deres offentlige test-nøkkel `3` (dokumentert av dem selv som fri å bruke, ingen registrering for gratis-nivået). Bekreftet direkte mot live-API-et: `access-control-allow-origin: *` — fungerer med vanlig `fetch()` fra nettleseren uten dev-proxy, i motsetning til Xtream-panelene.

Bygget, alt i `src/data/sports/`:
- ✅ `types.ts` — plattformnøytral `SportEvent`-type (dekker både lag-mot-lag-fixtures og enkelt-deltaker-hendelser som F1-økter/UFC-kort/golf-runder, som ikke har hjemme/borte-lag)
- ✅ `theSportsDbClient.ts` — tynn fetch-wrapper mot `eventsnextleague.php` og `livescore.php`, med en modul-lokal 3-minutters TTL-cache (høflig mot en delt gratis-API, unngår dobbel-fetching ved skjermbytte)
- ✅ `leagues.ts` — registry av 12 lag-ID-er (7 fotball-ligaer, F1, Golf, ATP-tennis, UFC, NBA) verifisert enkeltvis mot `lookupleague.php` før de ble lagt inn
- ✅ `mapEvent.ts` — mapper rå TheSportsDB-eventer/livescores til `SportEvent`, inkl. norsk/lokal tid-formatering ("Today HH:MM" / "Fri HH:MM")
- ✅ `useHomeFeed.ts` — henter alle relevante ligaer for valgt sport-filter parallelt, bygger `hero` (foretrekker en fixture med ekte banner/thumb-bilde), `liveNow` (kun fotball — se begrensning under), `tonight` (kronologisk sortert, ekskl. hero)
- ✅ `HomeScreen.tsx` skrevet om: ekte lasting/feil/tom-tilstander, hero-bakgrunn er nå et ekte `strBanner`/`strThumb`/`strPoster`-bilde fra API-et (med gradient-fallback beholdt for hendelser uten bilde — dekning er god for fotball, tynnere for andre sporter), lag-logoer vist i hero og Live Now-kortene
- ✅ `mockHome.ts` redusert til kun `sportFilters` (fortsatt legitimt statisk UI-config, resten var reelt mock-data og er nå fjernet)

**Viktige funn undersøkt og verifisert direkte mot API-et, ikke antatt:**
1. `eventsnextleague.php` returnerer **kun neste ene kamp** per liga, ikke en liste — derfor 7 fotball-ligaer i registeret i stedet for 1-2, for å få nok bredde i "Tonight"-raden (bekreftet med et frittstående script mot live-API-et: 12 ligaer ga 11 kommende hendelser totalt akkurat nå).
2. `livescore.php` gir kun reelle data for fotball på gratis-nivået (bekreftet: `Motorsport`/`Golf` returnerer `null`) — Live Now-raden henter derfor kun ekte live-fotball, og viser en ærlig "Nothing live right now"-melding når fotball ikke er valgt eller ingenting spilles, i stedet for å dikte opp F1/golf/tennis-livedata som ikke finnes.
3. Bilde-dekning (`strBanner`/`strThumb`/`strPoster`) er god for fotball (Premier League-fixtures har det konsekvent), tynnere for andre sporter — CSS-gradient-fallback fra før er beholdt nettopp av denne grunn, ikke fjernet.
4. `npx tsc --noEmit` og `npm run build:tizen` verifisert grønt etter alle endringene.

**Bevisst ikke gjort (utenfor det som ble bedt om denne runden):**
- **"Watch Now"-knappen er fortsatt kun visuell** — den kobler ikke til noen faktisk kanal i brukerens tilkoblede spilleliste. Dette er det uløste problemet fra research-runden: ingen sports-API vet hvilken kanal i *brukerens egen* Xtream/M3U-spilleliste som sender en gitt kamp. Trenger enten fuzzy-matching mot kringkaster-metadata (upålitelig) eller EPG-basert matching mot allerede tilkoblede kanaler (mer presist, men separat og ikke-trivielt arbeid — se forrige research-notat).
- Bakgrunnsbilder utover det API-et selv leverer (ingen egen kuratert stadion-bildebank bygget) — vurdert som overengineering før vi vet om TheSportsDB sin egen dekning er god nok i praksis.
- Ingen visuell verifisering i faktisk nettleser (ingen skjermbilde-/browser-verktøy tilgjengelig i denne økten) — verifisert i stedet ved å kjøre datalaget end-to-end mot det ekte API-et i frittstående Node-scripts og bekrefte `tsc`/build er grønt. **Bruker bør åpne `http://localhost:5173/` (eller den porten dev-serveren faktisk endte på) og se over Home-skjermen visuelt før dette regnes som ferdig verifisert.**
- Live Now-raden viser opptil 4 live fotballkamper når det finnes; ingen "kommer snart"-utfylling er lagt til for å late som det er flere — en tom/kort rad er et ærlig resultat av at få kamper faktisk er live akkurat nå.

**Liten, nødvendig navigasjons-tilføyelse (utover det som ble bedt om):** Home-skjermen var reelt uoppnåelig i den kjørende appen — `App.tsx` starter på Setup-skjermen, og `TopNav` sine nav-punkter var rent dekorative (kun `active`-styling, ingen klikk-handling). Uten dette kunne ikke bruker faktisk se resultatet av denne økten. La til minimal, eksplisitt merket midlertidig kobling: `TopNav` fikk `onSelectHome`/`onSelectChannels`-props (kun disse to — Matches/Live/Competitions har ingen skjermer bygget ennå, så de er bevisst latt urørt/ikke-klikkbare fremfor å navigere et sted som ville villede), `App.tsx` kobler dem til eksisterende `screen`-state. Dette er **ikke** ekte routing (Steg 22-kandidat-liste under nevner det fortsatt som gjenstående) — bare nok til at Home-nav-knappen faktisk gjør noe.

**Steg 22 — DELVIS FERDIG (2026-08-13): Kuratert stadion-bakgrunn for Premier League + hero-layout matchet mot skjermbilde**

Bruker sendte et stadion-nattbilde og ba om at det brukes som bakgrunn for Premier League-fixtures spesifikt, med logo-/tekstplassering identisk med referanseskjermbildet.

- ⚠️ **Blokkert på én ting bruker må gjøre:** Jeg har ingen verktøy for å lagre et innlimt bilde fra chatten til disk (kun tekst-/kodefiler kan skrives) — søkte gjennom vanlige temp-/utklippstavle-mapper også, fant ingenting. **Bruker må selv legge bildefilen på `public/backgrounds/premier-league.jpg`** (mappen er opprettet, tom) — koden er ferdig koblet til å bruke den derfra så snart filen finnes.
- ✅ `src/data/sports/leagues.ts` — `LeagueDef` fikk `staticBackground`, satt til `/backgrounds/premier-league.jpg` for Premier League (id 4328). Overstyrer API-ets eget event-bilde for **alle** PL-fixtures, uansett hvilke lag som spiller — matcher det brukeren ba om ("bakgrunn for premier league-fixtures", ikke bare denne ene kampen).
- ✅ `src/data/sports/mapEvent.ts` — `backgroundUrl` bruker nå `league.staticBackground` først, faller tilbake til `strBanner`/`strThumb`/`strPoster` fra API-et for ligaer uten kuratert bilde.
- ✅ **Hero-layout gjenoppbygd for å matche referanseskjermbildet nøyaktig:** lag-logoene sto tidligere stablet **under** tittelen — flyttet til å stå **ved siden av** tittelen (`hero-top`: tekst-kolonne + badge-kolonne i samme rad), badge-størrelse økt (48px → 84px) for å matche skjermbildets proporsjoner. La til kalender-/venue-SVG-ikoner foran tid/sted i meta-raden (var kun en prikk-separator før) — matcher skjermbildets 📅/🏟-ikonpar.
- ✅ Ryddet duplisert `.hero-content`-regel som oppsto underveis, fjernet nå-ubrukt `.dot`-styling.
- ✅ `tsc --noEmit` og `npm run build:tizen` verifisert grønt.

**Oppfølging samme steg:** bruker limte først inn bildet på nytt via chat (samme begrensning som over — kan ikke lagres direkte derfra), prøvde så selv å legge filen inn manuelt. Filen havnet på disk som `public/backgrounds/public:backgrounds:premier-league.jpg` (kolon i stedet for skråstrek — sannsynligvis en macOS Finder/Save-dialog-detalj der `:` er det historiske katalogskille-tegnet og blir vist/tolket annerledes enn `/`). Omdøpt til riktig `public/backgrounds/premier-league.jpg`, bekreftet at dev-serveren nå serverer den korrekt (200, `image/jpeg`).

Bruker så på faktisk kjørende resultat og ga presis tilbakemeldning: bildet satt fast i en avgrenset, avrundet boks i stedet for å dekke hele bredden og tone ut nederst slik referanseskjermbildet viser, og lag-logoene var for små.
- ✅ `.hero` gjort full-bleed: fjernet `border-radius`/`overflow: hidden`, lagt til negativ margin + kompenserende padding for å bryte ut av `.home-screen` sin innrammede padding, økt `min-height` til 560px.
- ✅ Ny bunn-fade lagt til (`.hero::after`, `linear-gradient(180deg, transparent 55%, var(--bg-primary) 100%)`) slik at bildet toner jevnt over i sidebakgrunnen i stedet for å stoppe brått ved en synlig boks-kant — matcher referansebildets "fade ut nederst".
- ✅ Venstre-mot-høyre mørklegging for tekstlesbarhet flyttet til `.hero::before` (ren opprydding, samme effekt som før, bare ikke lenger i konflikt med den nye bunn-faden på samme pseudo-element).
- ✅ `.hero-badge` økt fra 84px til 120px.
- ✅ `tsc --noEmit` og `npm run build:tizen` verifisert grønt på nytt.

**Enda en presisering fra bruker (store bokstaver — tydelig frustrert over at forrige runde ikke var nok):** bildet skal helt til toppen av **appen**, ikke bare fylle sin egen boks pent. Sport-filter-pillene (Football/F1/Golf/Tennis/All Sports) skal fjernes helt.

- ✅ **Sport-filter-raden fjernet helt** — `SportPill`-komponenten, `.sport-filters`/`.sport-pill`-CSS, og `mockHome.ts` (som kun inneholdt denne listen etter forrige opprydding) slettet. `HomeScreen` kaller nå `useHomeFeed('football')` direkte med en hardkodet sport i stedet for bruker-styrt filter — ingen UI for å bytte sport lenger (dette var eksplisitt det brukeren ba om, ikke en forglemmelse).
- ✅ **Hero flyttet til å faktisk nå toppen av appen (bak/under TopNav), ikke bare toppen av sin egen boks:** `.hero` er nå `position: absolute; top: -84px` (84px = TopNav sin høyde) i stedet for en normal flyt-blokk med et gap under navigasjonen — bildet strekker seg nå bokstavelig talt til `y=0` av appen, og TopNav flyter visuelt over det.
  - `.home-screen` fikk `position: relative` (nødvendig containing block for hero sin absolutte posisjonering)
  - `.hero-spacer` (ny, tom div) lagt inn i flyten der hero før tok plass, med utregnet høyde (`560px - 84px`) slik at Live Now/Tonight havner nøyaktig samme sted som før — uten denne ville hele resten av siden hoppet opp 84px når hero ble tatt ut av normal flyt
  - `TopNav` fikk `position: relative; z-index: 5` slik at den alltid rendres over hero-bildet (uten dette ville et posisjonert element som `.hero` malt seg over ren statisk innhold som navigasjonen, uansett DOM-rekkefølge — en CSS stacking-detalj, testet og verifisert med resonnement rundt stacking-kontekst, ikke gjettet). Denne endringen er trygg for alle andre skjermer siden ingenting annet konkurrerer om stacking der.
  - Ny `.hero-nav-scrim` — en mørk-til-transparent gradient begrenset til de øverste 160px av hero-bildet, slik at NINETY-logoen/nav-tekst forblir lesbar uansett hvor lyst bildet er akkurat der (himmel/lys), uavhengig av den eksisterende venstre-høyre-mørkleggingen som dekker hele boksen.
- ✅ `tsc --noEmit` og `npm run build:tizen` verifisert grønt.
- ⚠️ Fortsatt ikke visuelt verifisert i nettleser av meg (samme verktøybegrensning som før) — bruker bør sjekke at TopNav faktisk ligger synlig over bildet og at ingenting hopper/overlapper feil på de andre skjermene (Setup/Channels/Player), siden `TopNav`-endringen er delt på tvers av alle skjermer selv om den er designet for å være usynlig der.

**Steg 23 — FERDIG (2026-08-13): Onboarding-skjerm "Choose your favorite sports" + persistens (localStorage)**

Bruker sendte et skjermbilde av en sportsvalg-onboarding-skjerm og ba om at den bygges, vises etter tilkoblet spilleliste ved første gangs åpning, og at valget lagres. Spurte også eksplisitt: trenger vi en database til dette?

**Svar (også gitt direkte til bruker):** Nei — dette er ren enhets-lokal preferansedata (noen få valgte sporter/ligaer), ikke noe som trenger å synkroniseres på tvers av enheter. `localStorage` er riktig verktøy, ikke en ekte database.

Bygget:
- ✅ `src/core/storage/localStore.ts` — generisk typet `readStored`/`writeStored` over `localStorage`, med try/catch (Tizen Web Runtime støtter `localStorage` som enhver Chromium-nettleser, men preferanser skal ikke kunne krasje appen om lagring skulle feile)
- ✅ `src/data/preferences.ts` — `SportPreferences { sports: SportKey[]; footballLeagueIds: string[] }`, `loadPreferences`/`savePreferences`/`hasCompletedOnboarding`/`markOnboardingComplete`. `DEFAULT_PREFERENCES` (Football+F1, Premier League+Champions League) er det en bruker som trykker "Skip for now" faktisk får — samme verdier gjenbrukt som onboarding-skjermens forhåndshakede startvalg, for å matche skjermbildets synlige tilstand.
- ✅ `src/data/sports/leagues.ts` utvidet betydelig: alle 12 fotball-liga-ID-er fra skjermbildet lagt til og verifisert enkeltvis mot `lookupleague.php` (Eredivisie 4337, Primeira Liga 4344, MLS 4346, Championship 4329, Conference League 5071 var nye — resten fantes fra før), hver med ekte badge-URL fra API-et (ikke gjettet). `LeagueDef` fikk `badge`-felt. `SportKey` presisert fra en vag `'other'`-kurv til eksplisitt `'basketball'`/`'mma'`, siden onboarding-skjermen trenger å skille dem som egne valgbare sporter.
- ✅ `leaguesForPreferences()` (ny) — brukt av `useHomeFeed` i stedet for den gamle hardkodede `'football'`-strengen: henter kun de spesifikke fotball-ligaene brukeren faktisk valgte (ikke alle 12 — ville både flommet over den gratis API-en og ignorert selve poenget med onboarding), pluss alle ligaer for andre valgte sporter (kun én liga per sport i katalogen foreløpig, så ingenting mer å avgrense der).
- ✅ `src/features/onboarding/OnboardingSportsScreen.tsx` + `.css` + `sportIcons.tsx` — replika av skjermbildet: venstre infopanel (NINETY-logo, overskrift, beskrivelse, tre funksjons-punkter med stjerne/pokal/skyvebryter-ikoner, "Skip for now"), høyre valgpanel ("POPULAR SPORTS"-rutenett med 6 sport-ikoner tegnet som enkle SVG-piktogrammer — **ikke** forsøk på å gjenskape noen føderasjons ekte varemerkede logo, kun generiske ball/flagg/sekskant-symboler — og "FOOTBALL LEAGUES"-rutenett med 12 ekte liga-emblemer fra TheSportsDB), grønn hake-avkrysning på valgte kort, "Continue →"-knapp.
- ✅ **Bevisst avvik fra skjermbildet:** paginerings-prikkene nederst (antyder en flertrinns onboarding-wizard) og "Show more"-utvidelsen er **ikke** bygget — vi har kun denne ene skjermen å bygge (sport-valg), og å late som det finnes flere steg eller flere skjulte ligaer enn de 12 ekte vi faktisk har data for ville vært å dikte opp funksjonalitet ingen ba om ennå.
- ✅ `App.tsx` fikk `'onboarding'`-skjerm i `Screen`-unionen: etter `PlaylistSetupScreen.onLoaded` sjekkes `hasCompletedOnboarding()` — usann → onboarding vises, sann → rett til `browse-cascade` som før. `TopNav` skjules på onboarding-skjermen (den har sin egen NINETY-logo i venstre panel, matcher skjermbildet).
- ✅ `HomeScreen.tsx` oppdatert til å lese ekte lagrede preferanser via `loadPreferences()` i stedet for den midlertidige hardkodede `'football'`-strengen fra Steg 22 — onboarding-valget har nå faktisk effekt på hvilke ligaer Home-feeden henter.
- ✅ Fokus-håndtering fikset underveis: satte først `forceFocus` på selve onboarding-rot-containeren (feil mønster, sammenlignet med hvordan Hero/andre skjermer gjør det) — flyttet til det faktiske første fokuserbare kortet (Football-kortet) slik at `setFocus(ROOT_FOCUS_KEY)`-kallet fra `App.tsx` sin globale fokus-effekt faktisk har et reelt mål å lande på.
- ✅ `tsc --noEmit` og `npm run build:tizen` verifisert grønt (bakgrunnsbildet fra forrige steg pakkes nå også korrekt inn i `.wgt`, bekreftet i build-loggen).
- ⚠️ Ikke visuelt verifisert i nettleser (samme verktøybegrensning som tidligere økter) — bruker bør koble til en spilleliste på nytt (eller slette `localStorage`-nøkkelen `ninety.onboardingComplete` i devtools) for å faktisk se skjermen, siden den kun vises første gang per enhet.

**Oppfølging samme steg (2026-08-13):** bruker presiserte at Football Leagues-rutenettet kun skal vises når Football faktisk er valgt blant Popular Sports — ikke alltid synlig slik forrige runde bygde det. Når Football er avvalgt skal kun sport-rutenettet vises, sentrert.

- ✅ `OnboardingSportsScreen.tsx` — Football Leagues-seksjonen er nå betinget rendret (`{footballSelected && (...)}`) i stedet for alltid synlig.
- ✅ Sport-rutenettet pakket inn i egen `.sports-section`, som får `.centered`-klassen når Football ikke er valgt.
- ✅ `.onboarding-screen` sin grid endret fra `align-items: start` til `stretch` slik at høyre panel faktisk får full kolonnehøyde å sentrere innenfor. `.sports-section.centered` bruker `flex:1; justify-content:center; align-items:center` for å sentrere rutenettet i den ledige plassen leagues-seksjonen etterlater — "Continue"-knappen havner fortsatt naturlig nederst siden den sentrerte seksjonen selv fyller all gjenværende plass over den.
- ✅ `tsc --noEmit` og `npm run build:tizen` verifisert grønt.

**Steg 24 — FERDIG (2026-08-13): Admin/debug-panel for testing, via profilavataren**

Bruker trengte en måte å nullstille onboarding/preferanser på for å teste flyten på nytt uten å grave i devtools localStorage manuelt.

- ✅ `core/storage/localStore.ts` fikk `clearAllAppStorage()` — sletter kun nøkler med `ninety.`-prefiks (ikke `localStorage.clear()`), så andre ting som deler samme origin sin storage ikke rammes.
- ✅ `src/features/admin/AdminPanel.tsx` + `.css` — enkelt modal-overlay (samme mønster som `FilterPopup`: fokus-boundary, henter/gjenoppretter forrige fokus, `useBackHandler` slik at fjernkontroll-Back lukker den). Viser nåværende lagret status (onboarding fullført ja/nei, lagrede sporter) og én handling: "Reset onboarding & preferences" — krever ett ekstra trykk for å bekrefte (unngår at et vagt trykk sletter testdata ved uhell), sletter så app-storage og kjører `window.location.reload()`.
- ✅ `TopNav.tsx` — profilavataren (var en ren visuell `<div>N</div>`) er nå en faktisk fokuserbar/klikkbar knapp via ny `Avatar`-komponent, koblet til `onOpenAdmin`-prop.
- ✅ `App.tsx` fikk `adminOpen`-state, sender `onOpenAdmin={() => setAdminOpen(true)}` til `TopNav`, rendrer `<AdminPanel>` når åpen.
- ⚠️ Dette er eksplisitt et **test-/utviklerverktøy**, ikke en ekte profil-skjerm — avataren har ingen annen funksjon ennå (ingen brukerkontoer/profiler finnes i appen). Merket tydelig som sådan i kode og i selve panelets UI-tekst, slik at det ikke ved en feil blir stående som en "ekte" funksjon inn mot sertifisering senere.
- ✅ `tsc --noEmit` og `npm run build:tizen` verifisert grønt.

**Steg 25 — FERDIG (2026-08-13): Fullt 4-stegs onboarding-wizard (Playlist → Sports → Countries → Ferdig)**

Bruker sendte to skjermbilder til: en "Choose your favorite countries"-skjerm (steg 2 i en stepper med "Sports & Leagues ✓ / Countries / You're all set"), og deretter — midt i byggingen av Countries-steget — et tredje skjermbilde ("Add your playlist", vist som steg 3 i sin egen stepper) med beskjeden **"This should be the first step"**. Det betydde en omstrukturering: spillelistetilkobling (den gamle frittstående `setup`-skjermen) skulle flyttes til å bli selve steg 1 i wizarden, ikke noe som skjer før den.

**Ny rekkefølge:** Add your playlist (1) → Sports & Leagues (2) → Countries (3) → You're all set (4). Dette gir også en reell fordel: Countries-steget trenger ekte kanaldata for å vise noe som helst, og med spilleliste som steg 1 er den *alltid* tilgjengelig når steg 3 nås — ingen sjanse for at Countries-steget må håndtere "ingen spilleliste ennå".

**Delt fundament:**
- ✅ `onboardingShared.css` (ny) — layout-skjelettet (`.onboarding-screen` grid, infopanel, valgbare kort, continue-knapp) trukket ut fra `OnboardingSportsScreen.css` til en delt fil alle fire stegene bruker, siden de nå er fire separate skjermer i stedet for én. `.onboarding-screen` fikk en topbar-rad (`grid-template-rows: auto 1fr`) for den nye stepper-headeren.
- ✅ `OnboardingStepper.tsx` (ny) — `OnboardingStepper` (sirkler med hake/tall, forbindelseslinjer, aktiv/ferdig/venter-tilstander) + `OnboardingTopBar` (logo + valgfri stepper, delt av alle fire steg-skjermene).
- ✅ `OnboardingSportsScreen` refaktorert fra en selveid komponent (egen state + lagring) til en **kontrollert** komponent — all state (`selectedSports`/`selectedLeagues`) og lagre/fullfør-logikk løftet opp til den nye `OnboardingFlow`. `SelectableCard` eksportert herfra og gjenbrukt av Countries-steget.

**Steg 1 — Add your playlist:**
- ✅ `PlaylistSetupScreen.tsx`/`.css` bygget fullstendig om til å matche skjermbildet: to-kolonne wizard-layout (var tidligere en enkel sentrert kolonne), venstre infopanel med tre funksjonspunkter (Instant access/Your content/Private & secure) og en vertikal skillelinje (`with-divider`, eneste steg med denne — matcher nettopp dette skjermbildet, ikke retroaktivt lagt på de andre), høyre side med stor "M3U URL"-kortboks, "OR"-skillelinje, og en **ny, reell funksjon**: "Or enter stream code"-kortet er ikke lenger kun dekorativt — utvider seg til tre felt (Server/Username/Password) og bygger en `get.php`-URL internt (`buildXtreamUrl()`), gjenbruker eksakt samme `loadFromUrl()`-tilkoblingslogikk som URL-feltet allerede hadde. Info-boks nederst ("Don't have a playlist?") lagt til.
- ✅ Ingen "Back" på dette steget (ingenting å gå tilbake til — det er nå det faktiske første steget), ingen "Skip" heller (kan ikke hoppe over å koble til noe å faktisk vise appen med).
- ⚠️ Fil-opplasting (`M3U File…`) beholdt som egen, mindre fremtredende knapp under kortene — fortsatt den mest pålitelige veien forbi CORS i dev, som før.

**Steg 2 — Sports & Leagues:** uendret innhold fra Steg 23, men nå kontrollert av `OnboardingFlow`, med topbar/stepper (`current={2}`), og fikk en "← Back"-knapp til steg 1 ved siden av "Skip for now" (som fortsatt hopper over *resten* av wizarden med standardverdier, ikke bare dette steget).

**Steg 3 — Countries (det opprinnelig etterspurte steget):**
- ✅ `OnboardingCountriesScreen.tsx`/`.css` (ny) — **bevisst IKKE en hardkodet "popular countries"-liste** slik skjermbildet viser (UK/US/Germany/...) — i stedet utledet fra de faktisk tilkoblede kanalene via samme `parseCategory()`/`flagSrc()` som resten av Channels-funksjonaliteten allerede bruker, sortert etter reelt kanalantall per land. Dette er mer i tråd med hvordan resten av appen er bygget (ingen oppdiktet data) enn å kopiere skjermbildets eksempelland ordrett.
- ✅ Ekte SVG-flagg (samme selvhostede `public/flags/`-sett fra tidligere), "N channels"-undertekst per kort, "Select all"/"Deselect all"-knapper matcher skjermbildet.
- ✅ Forhåndsvalg: de 3 landene med flest kanaler i den tilkoblede spillelisten merkes automatisk (ikke de samme landene som i skjermbildet — kan ikke være det, siden det er ekte data — men samme idé: gi et fornuftig, ikke-tomt utgangspunkt).
- ✅ Tom-tilstand håndtert ærlig: hvis ingen land gjenkjennes i spillelisten, vises en forklarende tekst i stedet for en tom eller oppdiktet liste.

**Steg 4 — You're all set:**
- ⚠️ **Ikke noe skjermbilde mottatt for dette steget** — bygget bevisst minimalt (stort hake-ikon, "X sport(er) og Y land valgt"-oppsummering, "Start Watching"-knapp) fremfor å dikte opp detaljer designsystemet ikke faktisk spesifiserer ennå.

**Reell produkteffekt av Countries-valget (ikke bare visuelt):** `App.tsx` bruker nå `favoriteCountries` fra lagrede preferanser til å **forhåndsutfylle** `hiddenCountries` når onboarding fullføres — land som ikke ble valgt starter skjult i Channels-browsing (fortsatt endelig endrbart når som helst via det eksisterende Filter-popup-et, dette bestemmer bare startpunktet). Tom seleksjon (Skip, eller ingen land gjenkjent) betyr ingen filtrering i det hele tatt.

**Datamodell:** `SportPreferences` (i `data/preferences.ts`) fikk `favoriteCountries: string[]` (landnavn, samme vokabular som `hiddenCountries` allerede bruker — ikke landkoder). `DEFAULT_PREFERENCES.sports` rettet til `['football', 'f1']` — var feilaktig kun `['football']` i Steg 23 til tross for at den økten sin logg hevdet Football+F1 var standarden; oppdaget og fikset i denne økten.

**Arkitektur:** `OnboardingFlow.tsx` (ny) — eneste sted som faktisk kaller `savePreferences`/`markOnboardingComplete`, kun ved reell fullføring (Skip på steg 2, eller Start Watching på steg 4). De fire steg-skjermene selv er nå rene kontrollerte komponenter uten egen lagringslogikk. `App.tsx`s startskjerm avgjøres nå direkte av `hasCompletedOnboarding()` ved mount (`useState(() => ...)`) i stedet for alltid å starte på `setup` og finne det ut etter at spillelisten er lastet.

- ✅ `tsc --noEmit`, `npm run build:tizen`, og `npm run lint` (oxlint) verifisert — kun to allerede-aksepterte advarsler (ikke feil), ingen nye.
- ⚠️ Ikke visuelt verifisert i nettleser (samme verktøybegrensning som hele denne økten) — dette er den mest komplekse UI-endringen så langt i prosjektet og bør testes grundig manuelt: full 4-stegs flyt, Back/Skip-navigasjon på hvert steg, stream-code-tilkobling, og at Countries-valget faktisk reflekteres i Channels-browsingen etterpå.

**Steg 26 — FERDIG (2026-08-13): Hero-justering — konkurranselogo + matchweek i stedet for lag-logoer, stadion-ikon**

Bruker sendte to identiske skjermbilder av Home-hero (Arsenal vs Coventry City) og ba om tre presise endringer: fjern lag-logoene, legg til konkurranse-logo og stage/gameweek-tekst, bytt pin-ikonet for arena til et stadion-ikon.

- ✅ Lag-logoene (`hero-badges`, hjemme-/bortelag-emblemer ved siden av tittelen) fjernet helt fra `Hero`-komponenten.
- ✅ **Ny `.hero-league`-rad** øverst i hero-innholdet: liga-emblem (`event.leagueBadge`, samme felt vi allerede hentet fra TheSportsDB men aldri viste i hero) + liganavn, matcher skjermbildets "Premier League"-logo+tekst-plassering.
- ✅ **Matchweek lagt til reelt, ikke oppdiktet:** TheSportsDB sitt `intRound`-felt var hentet fra API-et men aldri mappet inn i `SportEvent` — lagt til (`round`) i `theSportsDbClient.ts`/`types.ts`/`mapEvent.ts`. Vises kun for lag-fixtures (`homeTeam && awayTeam`, ikke for enkelt-deltaker-hendelser som F1/UFC der et "matchweek"-begrep ikke gir mening) som `MATCHWEEK {round}` der `.hero-competition`-stilen (grønn, små versaler) tidligere viste liganavnet — det flyttet opp til den nye logo-raden i stedet.
- ✅ `VenueIcon` byttet fra et kart-pin-ikon til et enkelt stadion/arena-ikon (to konsentriske ellipser, antyder en bane sett ovenfra/skrått — samme linje-stil som de andre meta-ikonene).
- ✅ Ryddet: `.hero-top`/`.hero-text`/`.hero-badges`/`.hero-badge`/`.hero-badge-vs`-CSS-reglene fjernet siden ingenting bruker dem lenger.
- ✅ `tsc --noEmit` og `npm run build:tizen` verifisert grønt.
- ⚠️ Ikke visuelt verifisert i nettleser (samme verktøybegrensning som resten av denne økten).

**Steg 27 — FERDIG (2026-08-13): Kuratert F1-bakgrunn (Zandvoort-startbilde)**

Bruker sendte et F1-løpsbilde (Zandvoort, oransje folkemengde/røyk ved start) og ba om at det brukes som bakgrunn for F1, samme mønster som Premier League-bakgrunnen fra Steg 22.

- ⚠️ Samme blokkering som Steg 22 gjaldt her: kan ikke lagre et innlimt chat-bilde til disk selv — bruker la filen på `public/backgrounds/f1.jpg` mellom øktene. Bekreftet til stede ved starten av neste økt.
- ✅ `src/data/sports/leagues.ts` — F1-ligaen (id `4370`) fikk `staticBackground: '/backgrounds/f1.jpg'`, samme prioritetsrekkefølge som Premier League (`mapEvent.ts` bruker allerede `league.staticBackground` først, ingen kodeendring nødvendig der).
- ✅ `tsc --noEmit` og `npm run build:tizen` verifisert grønt.

**Steg 29 — FERDIG (2026-08-13): Persistens av spilleliste + Channels-filtervalg**

Bruker valgte dette som prioritet for denne økten, blant forslagene liggende fra forrige økt (persistens / ekte EPG / Matches-Live-Competitions-skjermer).

- ✅ `src/data/session.ts` (ny) — samme `readStored`/`writeStored`-mønster som `data/preferences.ts`: `loadPlaylist`/`savePlaylist` (kanaler + `XtreamCredentials | null`, nøkkel `ninety.playlist`) og `loadFilters`/`saveFilters` (`hiddenCountries`/`hiddenCategories` som arrays, nøkkel `ninety.channelFilters` — `Set` er ikke JSON-serialiserbart direkte).
- ✅ `App.tsx` — playlist og filter-state initialiseres nå fra lagret data (`useState(() => ...)`) i stedet for alltid å starte tomt, og et nytt effekt-par lagrer dem fortløpende ved endring. Ny startskjerm-regel: finnes en lagret spilleliste → rett til `home` (uansett `hasCompletedOnboarding()`-status, siden en lagret spilleliste i praksis beviser onboarding/setup allerede er gjort); ellers samme `setup`/`onboarding`-gren som før.
- ✅ Lagre-effekten for spilleliste er bevisst vokter mot å lagre en tom kanalliste (`if (channels.length === 0) return`) — det finnes ingen "koble fra"-handling i appen ennå, men vokteren koster ingenting og hindrer at en fremtidig slik handling utilsiktet visker ut en lagret spilleliste ved å nullstille state til `[]`.
- ✅ `AdminPanel` — "Reset onboarding & preferences" (allerede prefiks-scoped via `clearAllAppStorage()`, plukker automatisk opp de to nye nøklene uten kodeendring der) fikk oppdatert beskrivelsestekst, og statuspanelet viser nå også lagret kanalantall.
- ✅ **Bevisst utenfor scope for denne økten** (samme ikke-persisterte status som før, uendret): favoritter (kanaler/kategorier), nylig sett-liste, cascade-browserens drill-down-posisjon — brukeren ba spesifikt om spilleliste+filter, ikke alt non-persistert state i `App.tsx`.
- ✅ `tsc --noEmit`, `npm run build:tizen`, `npm run lint` (oxlint) verifisert — kun de to samme allerede-aksepterte advarslene, ingen nye.
- ⚠️ Ikke visuelt verifisert i nettleser — samme verktøybegrensning som resten av prosjektet (intet headless-browser-verktøy tilgjengelig denne økten, forsøkte `chromium-cli` via `run`-skillet, ikke installert). Bruker bør koble til en spilleliste, sette et filter, og trykke reload (F5) for å bekrefte at begge overlever — og at "Reset"-knappen i Admin-panelet fortsatt tar deg helt tilbake til start.

**Steg 28 — FERDIG (2026-08-13): Live Now / Coming Up-kort redesignet + heuristisk "live" for F1/tennis/golf/MMA/NBA**

Bruker sendte et skjermbilde av en redesignet Home-skjerm (rikere Live Now/Coming Up-kort med score, lag-logoer, konkurranse-fotnote, "se mer"-pil) og ba om grundig undersøkelse først. Undersøkte TheSportsDB direkte (ikke antatt fra dokumentasjon) før noe ble bygget:

**Viktige funn, verifisert direkte mot live-API-et:**
1. `eventsnextleague.php` slutter å returnere en hendelse **i det øyeblikket** den starter — ruller rett videre til neste. Det finnes altså ingen "pågår nå"-hendelse å hente derfra i det hele tatt. `eventspastleague.php` sin nyeste oppføring er eneste vei til å finne hendelsen som *nettopp* startet.
2. Ekte live-score (`livescore.php`) dekker fortsatt kun fotball på gratis-nivået (bekreftet på nytt for Tennis/Fighting — begge `null`).
3. **`livescore.php` har ikke noe liga-emblem-felt i det hele tatt** (bekreftet mot ekte fotball-/basketball-/baseball-nyttelast) — måtte legges til som eget, deduplisert oppslag (`fetchLeagueBadge` → `lookupleague.php` per unik `idLeague` blant de faktisk live kampene, ikke én per kamp).
4. Ingen Grand Slam-turnering (Roland Garros osv.) finnes som egen liga i TheSportsDB, og ATP/WTA Tour sine "neste hendelse"-endepunkter returnerer `null` akkurat nå — tennis-dekningen er for tynn til å bygge mot pålitelig ennå, utover selve heurstikken.

**Bruker presiserte:** for F1/tennis (og implisitt andre sporter uten ekte live-data) trengs ingen ekte score/resultat — et **gjetning basert på annonsert starttidspunkt vs. nå** er godt nok.

Bygget:
- ✅ `theSportsDbClient.ts` — `fetchPastEventsForLeague()` (ny), `fetchLeagueBadge()` (ny, med samme 3-min-cache som resten)
- ✅ `liveHeuristic.ts` (ny) — `isHeuristicallyLive(sportKey, title, dateTimeUtc)`: sjekker om nyeste forbi-hendelse fortsatt er innenfor en sport-typisk antatt varighet (F1 90 min / 150 min for "Race" i tittelen, Tennis 150, Golf 300, MMA 240, Basketball 150) — bevisst grove antagelser, dokumentert som sådan, ikke hentet fra noen autoritativ kilde
- ✅ `SportEvent` fikk `isLiveHeuristic` (skiller gjettet-live fra ekte live-score), `homeScore`/`awayScore`/`liveClock` erstattet den gamle sammenslåtte `liveScoreLabel`/`liveMinute` slik at kortene kan vise poeng per lag-rad i stedet for én kombinert streng
- ✅ `useHomeFeed.ts` — henter nå **både** ekte fotball-live (med deduplisert badge-oppslag) **og** heuristisk-live for hver ikke-fotball-liga brukeren har valgt, slått sammen i `liveNow`. Ingen falsk score/klokke vises noensinne for heuristiske treff — kun en LIVE-merking basert på tid.
- ✅ `HomeScreen.tsx`/`.css` — kort fullstendig redesignet: `CardBody` viser to lag-rader med logo+navn+score (høyrejustert) for ekte fixtures, eller et sport-ikon + tittel for enkelt-deltaker-hendelser (F1-økter osv. — gjenbrukte de allerede bygde sport-ikonene fra onboarding i stedet for å tegne nye); `CardCompetition`-fotnote (emblem + liganavn) delt av begge rad-typer; `ScrollRow` (ny, delt komponent) gir begge radene en sirkulær "se mer"-pil som scroller i stedet for å kutte av data — matcher skjermbildets antydning om flere kort enn det som er synlig med én gang
- ✅ "Tonight" omdøpt til "Coming Up" (matcher skjermbildet)
- ✅ Datalag-cap på "kommende hendelser" (var `.slice(0,8)`) fjernet — nå at rad-UI-en selv håndterer overflow via scroll, er det ingen grunn til å kutte ekte data kunstig tidlig
- ✅ Verifisert end-to-end med et frittstående script mot det ekte API-et: heuristikken kjører feilfritt og rapporterer korrekt "ikke live" for alle sjekkede ligaer akkurat nå (f.eks. PGA-runde 1 startet for 10,5 timer siden — utenfor det antatte 5-timersvinduet, korrekt ekskludert) — ærlig degraderer til "ingenting live" fremfor å tvinge frem noe.
- ✅ `tsc --noEmit`, `npm run build:tizen`, `npm run lint` (oxlint) verifisert — kun de to samme allerede-aksepterte advarslene, ingen nye.
- ⚠️ Ikke visuelt verifisert i nettleser — og i dette tilfellet heller ikke mulig å verifisere visuelt at et faktisk live-kort ser riktig ut akkurat nå siden ingenting er live i noen av de fulgte ligaene i skrivende stund. Bør sjekkes på nytt en gang med faktisk live fotball i gang.

**Steg 30 — FERDIG (2026-08-13): Kuratert Golf-bakgrunn**

Bruker la selv `public/backgrounds/golf.png` (nattbilde, spiller i sving foran opplyst tribune) mens dev-serveren tilfeldigvis var nede — se merknad i Steg 29-loggen: en "reset fungerer ikke"-bug-rapport viste seg å faktisk skyldes at `npm run dev` var drept under forrige økts build-verifisering, ikke en feil i reset-koden selv. Startet serveren på nytt, avklarte, fortsatte deretter med bakgrunnsbildet.

- ✅ `src/data/sports/leagues.ts` — golf-ligaen (id `4425`, PGA Tour) fikk `staticBackground: '/backgrounds/golf.png'`, samme mønster/prioritet som Premier League og F1.
- ✅ `tsc --noEmit` og `npm run build:tizen` verifisert grønt.
- ⚠️ Ikke visuelt verifisert i nettleser (samme verktøybegrensning som resten av prosjektet).

**Steg 31 — FERDIG (2026-08-13): Scrollbar skjult på Home-radene, Home alltid første skjerm, og — hovedsaken — bytte til api-football.com for fotball-kampdata**

Tre separate ting bruker ba om i samme økt, siste er den store:

1. **Scrollbar fjernet visuelt** fra Live Now/Coming Up-radene (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }` på `.scroll-row`) — bruker påpekte at et skrollefelt ikke er relevant på en fjernkontroll-styrt TV, siden navigasjon skjer med piltaster, ikke mus/touch. Selve scroll-funksjonaliteten (chevron-knapp, fokus-følging) er uendret.
2. **Home åpner alltid først, også første gang appen noensinne startes** — `App.tsx` sin skjerm-state starter nå alltid på `'home'` i stedet for å tvinge `setup`/`onboarding` foran. Dette går fordi Home sin data (TheSportsDB sportsdata) er helt uavhengig av den tilkoblede IPTV-spillelisten — det var aldri noen reell grunn til at Home måtte vente. Onboarding (som starter med spilleliste-tilkobling) trigges nå i stedet når brukeren faktisk navigerer til Channels uten tilkoblet spilleliste (`onSelectChannels` i `App.tsx`), ikke lenger ved app-oppstart.
3. **Fotball-kampdata byttet fra TheSportsDB til api-football.com** — den store fiksen denne økten, etter grundig undersøkelse (ikke antatt):
   - Bruker rapporterte at mange Europa League/Conference League-kamper "i dag" ikke vistes i Coming Up, og presset tilbake da jeg først konkluderte for raskt. Grov research i TheSportsDBs offisielle dokumentasjon (hentet direkte, ikke gjettet) avdekket at **hvert eneste endepunkt vi bruker har en dokumentert "Free Limit"** — `eventsday.php` er hardkodet til maks **3 resultater per kall** uansett hvor mange kamper som faktisk finnes, `eventsnextleague.php`/`eventspastleague.php` maks **1**, ingen paginering finnes for å komme forbi dette på gratisnøkkelen. Bekreftet empirisk: samme `eventsday.php?l=4481`-kall ga konsekvent nøyaktig 3 kamper ved gjentatte kall, mens et `searchevents.php`-oppslag beviste at f.eks. Beşiktaş-kampen fantes i databasen med riktig liga+dato, men aldri ble returnert av dag-kallet.
   - Undersøkte tre alternative leverandører (research, ikke antatt): `football-data.org` (gratisnivå mangler Europa/Conference League helt), Sportmonks (gratisnivå kun 2 obskure ligaer), **api-football.com/api-sports.io** (gratisnivå: 100 forespørsler/dag, **ingen per-forespørsel-cap på antall resultater** — bekreftet direkte: ett `/fixtures?date=` -kall ga alle 37 kampene i EL+ECL samme dag, inkludert Beşiktaş).
   - Bruker opprettet selv gratis-konto på api-football.com og delte API-nøkkelen. Lagret i ny `.env`-fil (ikke committet — `.env`/`.env.*` lagt til `.gitignore`, `.env.example` lagt til som mal). Siden appen er en ren klient-app uten backend, er nøkkelen uunngåelig synlig i den bygde JS-bundlen/nettverkskall — samme tillitsmodell som TheSportsDBs allerede hardkodede offentlige testnøkkel. Verste konsekvens ved lekkasje er noen andre bruker opp dagskvoten, ikke en fakturarisiko (gratisnivå, ikke kort tilknyttet).
   - Ny `src/data/sports/apiFootballClient.ts` — én funksjon, `fetchFixturesByDate(dateYmd)`, som henter **alle** ligaers kamper for én dag i ett kall (filtrering på våre fulgte ligaer skjer klient-side, ikke server-side per liga) — dette er selve grunnen til byttet. 5 min cache (mot 3 min for TheSportsDB) siden kvoten er både mindre og personlig.
   - `LeagueDef` (i `leagues.ts`) fikk nytt `apiFootballId`-felt (api-footballs egen id-nummerering, adskilt fra TheSportsDB sin `id` — de to romene deler ikke id-er) satt på alle 11 fotball-ligaer, slått opp direkte mot api-football sitt `/leagues?search=`-endepunkt (ikke gjettet fra navn).
   - `useHomeFeed.ts` delt i to spor: fotball-ligaer bruker nå api-football via et 3-dagers fremover-vindu (`FOOTBALL_LOOKAHEAD_DAYS = 3`, altså 3 kall totalt — ikke ett per liga) siden api-football sin gratisnøkkel **heller ikke** har noen "neste kamp"-parameter (`next=`-parameteren feiler eksplisitt på gratisplanen, bekreftet direkte) — vinduet er i stedet det som gir en stille liga sin neste kamp naturlig plass til å dukke opp. Alle andre sporter (F1/golf/tennis/MMA/basketball) bruker fortsatt TheSportsDB uendret — lavt volum der, ikke verdt å bruke av den mindre api-football-kvoten.
   - `mapEvent.ts` fikk `mapApiFootballFixture()` — viktig gevinst utover selve fullstendigheten: api-football sitt `league.round`-felt er en **ferdig menneskelesbar tekst** ("3rd Qualifying Round", "Regular Season - 3"), i motsetning til TheSportsDBs `intRound` som bare er et internt tall-kode uten tekst (bekreftet at `intRound: "400"` for Europa League faktisk betyr en kvalifiseringsrunde, ikke bokstavelig "matchweek 400" — bruker hadde helt rett i at "MATCHWEEK 400" var feil/villedende). `HomeScreen.tsx` sin hero viser nå denne teksten direkte (versalisert) i stedet for en hardkodet "MATCHWEEK "-prefiks.
   - Samtidig fikset: hero-kortet plukket tidligere `upcoming.find(ev => ev.backgroundUrl) ?? upcoming[0]` — altså den første kommende hendelsen som *tilfeldigvis* hadde et bilde, ikke nødvendigvis den faktisk neste kronologisk. Siden F1 alltid har et kuratert bakgrunnsbilde (Steg 27) mens dagens faktiske neste fotballkamp ofte manglet API-bilde, kunne en fredags F1-økt stjele hero-plassen fra en kamp som startet om få timer. Rettet til alltid `upcoming[0]` (listen er allerede kronologisk sortert) — manglende bilde faller tilbake til CSS-gradienten som allerede fantes.
   - Robusthet lagt til underveis (samme mønster fra Steg 29): per-liga/per-dag-kall og live-score-oppslagene er nå try/catch-innpakket slik at ett mislykket/rate-limited kall degraderer til "ingen data derfra" i stedet for å blanke ut hele feeden — dette var selve årsaken til en mellomliggende regresjon denne økten (429 fra TheSportsDB da jeg først doblet forespørsler før api-football-byttet) — nå fikset ordentlig ved roten (riktig datakilde) i stedet for bare plastret over.
   - ✅ `tsc --noEmit`, `npm run build:tizen`, `npm run lint` (oxlint) verifisert — kun de to samme allerede-aksepterte advarslene, ingen nye.
   - ⚠️ Ikke visuelt verifisert i nettleser av meg (samme verktøybegrensning som resten av prosjektet) — bruker bør reloade og bekrefte at Coming Up nå viser hele dagens kampprogram i riktig rekkefølge, at hero viser faktisk neste kamp/økt, og at rundetekst for cup-kamper viser noe fornuftig (f.eks. "3RD QUALIFYING ROUND") i stedet for "MATCHWEEK 400".
   - **Oppfølging å vurdere senere, ikke gjort nå:** api-football sin gratisnøkkel dekker også F1/basketball/MMA/etc som egne separate API-er (synlig i brukerens dashboard-skjermbilde, hver med egen 100/dag-kvote) — kunne på sikt erstattet TheSportsDB helt for enda bedre datakvalitet, men utenfor denne øktens avgrensede oppgave (kun fotball var det faktiske problemet).

## 3c. Steg 32–33 (2026-08-13, samme økt som Steg 29–31)

**Steg 32 — FERDIG: Hero-scoring-system (hvilken kamp fremheves) + Watch Now vs. Event Preview + hero-visuell-iterasjon**

Bruker påpekte at "flest kamper i dag"-fikset fra Steg 31 ikke var nok — trengte en reell vekting av *hvilken* kamp som vises som hero, ikke bare kronologisk først, og presiserte senere at relevans (hvor snart noe starter) er den klart viktigste faktoren.

- ✅ `src/data/sports/heroScoring.ts` (ny) — to-lags valg, ikke én blandet skår:
  1. **"Nå"-terskel:** live ELLER innen én time vinner alltid over alt annet (uansett prestisje) — kun blant *disse* brytes uavgjort med en vektet skår (liga-prestisje 45%, runde/stadium 25%, recency 30%, hånd-kuraterte tall dokumentert som redaksjonelle valg, ikke fakta).
  2. Ellers: faller tilbake til det ENESTE nærmeste tidspunktet blant kommende hendelser (± 5 min toleranse for samtidige kamper) — skåren brukes kun til å bryte uavgjort *innad* i det tidspunktet, ikke til å hente frem noe lenger frem i tid.
- ✅ `HomeFeed` fikk `heroIsWatchableNow: boolean` — knappeteksten endres deretter: **"▶ Watch Now"** kun når faktisk innen en time/live, ellers **"Event Preview"**. Selve knappen var uansett aldri koblet til avspilling før dette — fikset kun tekst/logikk her, faktisk kanal-tilkobling kom i Steg 33.
- ✅ Personalisering (f.eks. vekte et norsk lag høyere fordi bruker har valgt Norge som favorittland) bevisst **utelatt** etter direkte spørsmål til bruker — venter på en pålitelig lag-nasjonalitets-datakilde, bygget slik at det kan legges til som et fjerde vektet ledd senere uten omskriving.
- ✅ Hero-visuell iterasjon (flere runder frem og tilbake med bruker): liga-logo prøvd i flere varianter (44px → 120px, hvit bakgrunnsboks, myk glødeeffekt, skarp hvit kontur) — endte til slutt på **å droppe logobildet helt** og vise ren hvit tekst (liganavn), siden UEFA sine emblemer stort sett er sort strek-kunst som forsvinner mot et mørkt bakgrunnsbilde uansett triks. Runde-teksten ("3RD QUALIFYING ROUND") flyttet fra egen linje → samme rad som liganavn (med "·") → tilbake til egen linje under, etter direkte tilbakemelding.
- ✅ **Ekte bug funnet og fikset:** to bakgrunnsbilde-filer brukeren lastet opp (`Europa_League.png`/`Confrerence_League.png`) var byttet om — filen navngitt "Europa_League.png" viste faktisk den grønne UEFA CONFERENCE LEAGUE-skiltingen i stadionbildet (bekreftet ved å åpne filene direkte, ikke anta ut fra filnavn). Rettet ved å bytte hvilken fil hver liga peker til i `leagues.ts` — ikke ved å omdøpe brukerens filer. Golf- og Champions League-bakgrunner koblet inn samtidig.
- ✅ Piltast-navigasjon i Live Now/Coming Up rullet ikke det fokuserte kortet inn i synsfeltet — samme `scrollIntoView({ inline: 'nearest', block: 'nearest' })`-mønster som `ListRow.tsx` allerede brukte, lagt til på begge kort-komponentene. Scrollbar-linjen under radene skjult visuelt (`scrollbar-width: none`) — irrelevant på fjernkontroll, selve rullingen uendret.
- ✅ `tsc`/`build:tizen`/`lint` grønt gjennom hele økten.

**Steg 33 — FERDIG: Kanal-matching — "hvilken kanal i min spilleliste viser denne kampen"**

Det ubesvarte spørsmålet fra tidligere i prosjektet. Bruker avviste et forslag om manuell brukeropplæring (velg kanal selv første gang) eksplisitt: "we need proper data here, thats the whole point."

- ✅ Ny skjerm `src/features/eventDetails/EventDetailsScreen.tsx` — Hero-knappen og hvert Live Now/Coming Up-kort er nå klikkbare/enter-bare og navigerer hit (ny `event-details`-skjerm i `App.tsx`s skjerm-union). Viser kamp-info + en "Available On"-liste; valg av kanal derfra gjenbruker eksisterende `watchChannel`/`ChannelPlayerScreen`-flyt uendret.
- ✅ Undersøkte gratis-alternativer for kringkaster-/TV-kanal-data grundig (dokumentert direkte til bruker): **ingen gratis API har dette** — kommersielt lisensiert data. Eneste reelle treff: **Sportmonks Starter-plan** (€29/mnd, 14-dagers prøveperiode via betalt abonnement — bruker opprettet dette selv og delte token, valgte CL/EL/ECL + PL/La Liga/Bundesliga/Ligue 1/Serie A som sine 5+bundle-ligaer).
- ✅ `src/data/sports/sportmonksClient.ts` (ny) — `fetchFixturesWithTvStations(dato)`, ett kall per dag med `include=tvstations.tvstation;tvstations.country` gir ekte kringkasternavn+land per kamp.
- ✅ `src/data/sports/channelMatch.ts` (ny) — to-stegs matching: (1) Sportmonks (primær) — finn riktig kamp via lag-navn+klokkeslett, match kringkasternavn mot spillelistens kanalnavn; (2) EPG-tekst (Xtream `get_short_epg`, fallback) — samme svakere heuristikk som før, kun når Sportmonks ikke dekker kampen. Søker **alle** kanaler i spillelisten (ikke begrenset av Channels-browsingens landfilter) og inkluderer PPV-kategoriserte kanaler i EPG-fallbacken, ikke bare de med "Sport" i navnet — begge presisert av bruker.
- ✅ **To ekte bugs funnet og fikset via faktisk feilsøking (brukerens DevTools-skjermbilder, ikke antagelser):**
  1. **Sportmonks har ingen CORS-header i det hele tatt** — kallet ble stille blokkert i dev-nettleseren uten fallback. Rettet ved å rute gjennom samme dev-only CORS-proxy (`fetchWithDevCorsFallback`) som Xtream-kallene allerede bruker; produksjons-Tizen-bygget trenger det ikke (WARP `<access origin="*">` i `config.xml` dekker det).
  2. **Falske positive ved nummererte søsterkanaler:** "Arena Sport Premium 1" matchet *alle* sju "Arena Sport 1–7 RS"-kanalene samtidig, fordi matchingen kun krevde étt felles ord ("ARENA") og et for aggressivt filter fjernet enkeltsifrede kanalnumre som "støy" før sammenligningen. Fikset med en "nummer-sperre": hvis *begge* navn har et eksplisitt kanaltall, må tallene stemme overens i tillegg til et felles merkevare-ord — verifisert med frittstående testscript før/etter.
  - ⚠️ Kjent, akseptert restrisiko: to ulike kanaler som deler ett vanlig ord uten kanalnummer å skille på (f.eks. "Pro Arena" vs. "Arena Sport") kan fortsatt sammenfalle — tekstmatching har en iboende presisjonsgrense.
- ✅ `tsc`/`build:tizen`/`lint` grønt.
- ⚠️ Bruker har bekreftet treff på minst én kamp (Tobol vs Partizan → Arena Sport 1 RS m.fl.) etter siste fiks, men bør teste flere kamper/ligaer/spillelister for å få tillit til treffraten.

## 3b. Nåværende steg — hva er reelt igjen

**Umiddelbart neste steg:** Brukertest kanal-matchingen (Steg 33) videre — flere kamper, gjerne også ligaer som *ikke* er blant de 8 Sportmonks-dekkede (bør falle tilbake til EPG-stien) — før noe nytt tas fatt på.

**Kjente, bevisst utsatte hull (ikke feil, bare ugjort):**
1. Personalisering i hero-scoring (favorittland/lag vektet høyere — utsatt i Steg 32, trenger en lag-nasjonalitets-datakilde)
2. "Set Reminder"-knappen fra brukerens referanseskjermbilde — eksplisitt utelatt fra Steg 33 sitt omfang
3. **Sportmonks er en 14-dagers prøveperiode** (starter ~2026-08-13, går ut ~2026-08-27) — deretter belastes kortet automatisk (€29+/mnd) med mindre bruker sier opp. Minn bruker på dette i god tid før fristen.
4. Matches/Live/Competitions-skjermene i toppnavigasjonen har fortsatt ingen faktisk innhold (kun Home og Channels er reelle skjermer)
5. Ekte NINETY-spiller-UI (fullscreen/overlay/kontroller — Fase 5) er fortsatt bare en minimal testspiller
6. Country-laget i Channels-browsing bruker fortsatt egen heuristikk, ikke noe delt med sports-siden

Avklar med bruker hvilken del som er neste prioritet før noe av dette tas — hold det til én avgrenset del per økt slik det er gjort så langt.

---

## 4. Loggført fremdrift

- **2026-08-12**: Kartla prosjektstatus (helt tidlig Vite-mal). Skrev denne planen. Ingen kodeendringer gjort ennå.
- **2026-08-12**: Steg 1 gjennomført — `config.xml`, placeholder-ikon, `index.html`-opprydding, `tizen.d.ts`. Se merknader om placeholder package-ID og placeholder-ikon over — begge må erstattes før faktisk sertifisering/pakking.
- **2026-08-12**: Steg 2 gjennomført — `scripts/build-tizen.mjs` + `npm run build:tizen` produserer usignert `.wgt`. Tizen Studio/CLI er bevisst **ikke** installert her (stort manuelt/lisensbetinget steg, hører til Fase E). Fikset et pre-eksisterende, urelatert build-brekk (manglende `App.css`/`react.svg` fra Vite-malen) etter avklaring med bruker.
- **2026-08-12**: Steg 3 gjennomført — `core/platform`-lag (NavIntent-mapping, Tizen-tasteregistrering, stack-basert Back-håndtering) + koblet inn i `main.tsx` sammen med spatial-navigation-init.
- **2026-08-12**: Steg 4 gjennomført — designtokens fra designsystem-dokumentet lagt inn som CSS-variabler, `index.css` ryddet for TV/dark-only, fast 1920×1080-canvas. Avklarte at OS-nivå skalering på Tizen/Google TV gjør JS-basert viewport-scaling unødvendig — dokumentert i kode, ikke bygget.
- **2026-08-12**: Steg 5 gjennomført — `core/player`-abstraksjonslag (`Player`-interface + HTML5/hls.js-implementasjon). Tizen AVPlay-implementasjon bevisst utelatt til vi har et ekte DRM-behov å teste mot. Fundament-fasene (A–D) er nå komplette på abstraksjonsnivå; gjenstående arbeid er enten reell skjermbygging eller manuelt enhets-/CLI-oppsett (Fase E), se punkt 3b for hvordan disse to bør holdes adskilt fremover.
- **2026-08-12**: Steg 6 gjennomført — Home-skjerm bygget som replika av skjermbildet brukeren sendte (TopNav + sport-piller + hero + Live Now + Tonight), verifisert i nettleser via `npm run dev` på `http://localhost:5173/`.
- **2026-08-12**: Steg 7 gjennomført — M3U-parser, Playlist Setup-skjerm (URL + fil-fallback for CORS), og en testspiller-skjerm koblet til `core/player`. Fant og fikset at `hls.js` blåste opp hovedbunten til 762 KB — byttet til dynamisk import. Appen starter nå på Setup-skjermen for å gjøre testing enkelt; dette er midlertidig frem til ekte routing finnes.
- **2026-08-12**: Steg 8 gjennomført — research-drevet: oppdaget at brukerens test-URL er en Xtream Codes-panel-URL, bygget `data/xtream`-lag (JSON API-klient + mapper til delt `Channel`-type). Viktigst: avklarte at CORS-problemet løses skikkelig i produksjon via Tizen sin WARP `<access>`-policy i `config.xml` (lagt til) — dev-proxyen er nå eksplisitt merket som en dev-only testing-hjelper, ikke en produksjonsløsning.
- **2026-08-12**: Steg 9 gjennomført — fikset faktisk avspilling (HLS-bevisst dev-proxy som skriver om segment-URI-er i manifestet) og bygget Channels-skjermene (root/kategori/kanalliste+info-panel) pixel-nært skjermbildene brukeren sendte, med ekte kategoridata fra tilkoblet spilleliste. Bevisst utelot fiktiv Country-lagdata og oppdiktet EPG-innhold — dokumentert som ærlige avvik fra mockupene, ikke glemte features.
- **2026-08-12**: Steg 10 gjennomført — avspilling fortsatt brutt, root cause #2 funnet: Xtream-paneler serverer rå MPEG-TS som standard, ikke HLS. Lagt til mpegts.js som eget avspillingsspor. Fant og fikset en alvorlig streaming-bug i dev-proxyen (bufret uendelige live-strømmer i minnet i stedet for å strømme dem). Gjeninnførte Country-laget med ekte data etter at bruker opplyste om landskode-prefikset i kategorinavnene.
- **2026-08-12**: Steg 11 gjennomført — ekte SVG-flagg (selvhostet), og full kvalitetsvariant-sammenslåing for kategorier og kanaler (`data/normalize.ts`, ny `Channel.sources[]`-modell). Fant og fikset en falsk-positiv i egen tag-liste (GOLD/PREMIUM kolliderte med ekte kanalnavn) ved å teste mot brukerens faktiske eksempler før den ble ansett ferdig.
- **2026-08-12**: Steg 12 gjennomført — bruker viste skjermbilder som avslørte at sammenslåingen fra Steg 11 faktisk ikke virket i produksjon. Undersøkte dataen nøye og fant to rotårsaker: (1) landsnavn er stavet fullt ut ("NORWAY"), ikke kode, og kanal-prefiks bruker kolon ("NO:"); (2) kvalitetstagger er skrevet med Unicode-"superscript"-bokstaver (ⱽᴵᴾ, ᴴᴰ), ikke ASCII. Bygget `matchLeadingCountry()` og `foldForMatching()` for å håndtere begge. Fant og fikset en alvorlig følgefeil underveis der egen "dekorativ tekst"-opprydding kuttet bort ekte norske bokstaver (Æ/Ø/Å).
- **2026-08-12**: Steg 13 gjennomført — stor sammensatt bestilling: fjernet kategori-navigasjonssteget (kun Land → Kanaler nå), lagt til Regular/PPV-gruppering i kanallisten, en rent visuell filter-popup for land/kategorier, fjernet alle kategoriikoner, lagt til en live forhåndsvisnings-miniplayer i info-panelet, og — viktigst av alt — endelig koblet det upåaktede `core/platform`-Back-handler-laget fra Steg 3 til faktiske skjermer slik at tastatur/fjernkontroll-Back fungerer. Kosmetisk Unicode-fold lagt til for ord som ikke gjenkjennes som tag.
- **2026-08-12**: Steg 14 gjennomført — bruker korrigerte at kategori-nivået skulle beholdes (ikke fjernes som i Steg 13); gjenopprettet Land→Kategori→Kanaler med Vanlig/PPV-gruppering flyttet til kategorinivå. Presiserte PPV-forklaringen (enkelthendelser, ingen ekstra kostnad — ikke "billed separately" som først skrevet). Fant og fikset rotårsaken til at piltastene ikke virket: biblioteket krever eksplisitt `setFocus()`-kall, som aldri var gjort noe sted.
- **2026-08-12**: Steg 15 gjennomført — presiserte PPV-forklaringen videre etter mer kontekst fra bruker: dette er enkeltstående sendinger av spesifikke hendelser (f.eks. én kamp) som kun finnes som egen strøm, typisk når kringkasteren ikke sender den på noen fast TV-kanal.
- **2026-08-12**: Steg 16 gjennomført — bruker bekreftet avspilling fungerer. Fjernet pris-nevning fra PPV-tekst helt (ingenting koster ekstra, unødvendig å nevne). Fjernet forhåndsvisningsvideo + logo fra info-panelet (tok for mye plass). Implementerte ekte EPG via Xtream sitt `get_short_epg`, med forsvarlig base64-deteksjon og gjenoppretting av `stream_id` fra avspillings-URL siden det ikke lagres i den sammenslåtte kanalmodellen.
- **2026-08-13**: Steg 21 gjennomført (autonom nattøkt) — Home-skjermen koblet til ekte data via TheSportsDB sin gratis API (`src/data/sports/`): fixtures, lag-logoer, bakgrunnsbilder fra API-et. Verifiserte API-ets faktiske oppførsel (kun ett neste-event per liga, livescore kun for fotball på gratis-nivå) med frittstående scripts før bygging, i stedet for å anta fra dokumentasjon. `tsc`/`build:tizen` grønt. Ikke visuelt verifisert i nettleser (intet skjermbilde-verktøy tilgjengelig denne økten) — bør sjekkes av bruker. "Watch Now" er fortsatt kun visuell; kanal-matching mot brukerens spilleliste er uløst og bevisst utsatt.
- **2026-08-13**: Steg 20 rekonstruert og loggført i etterkant (var ikke logget fortløpende) — ettkolonne cascade-browser (Country/Category/Channel/Preview) erstattet den gamle skjerm-per-nivå-flyten, nye Favorites/Recently Watched-skjermer lagt til, `playerReturnScreen` gjør at spillerens Back returnerer riktig sted. Build verifisert grønt.
- **2026-08-12**: Steg 17 gjennomført — to bugfikser fra brukertesting: forhåndsvisningsvideoen ble feilaktig fjernet i Steg 16 (kun logo skulle bort) — gjenopprettet. EPG-tekst hadde mangled norske tegn ("TegnsprÅ¥knytt" i stedet for "Tegnspråknytt") pga. feil UTF-8-tolkning av `atob()`-resultatet — fikset med `TextDecoder`, verifisert med direkte Node-reproduksjon av bugen før og etter.
- **2026-08-13**: Steg 32 gjennomført — hero-scoring-system (to-lags: live/innen-en-time slår alt annet, ellers nærmeste tidspunkt), Watch Now vs. Event Preview-knappetekst, hero-visuell-iterasjon (endte på ren tekst, ingen logo/glødeeffekt), fikset ombyttede bakgrunnsbilde-filer (Europa/Conference League), scroll-into-view på piltast-navigasjon. Personalisering i scoring bevisst utsatt (ingen lag-nasjonalitets-datakilde ennå).
- **2026-08-13**: Steg 33 gjennomført — kanal-matching bygget ("hvilken kanal viser denne kampen"): ny EventDetailsScreen, Sportmonks (betalt, 14-dagers prøve — brukeren opprettet konto selv) for ekte kringkasterdata som primærkilde, EPG-tekst som fallback. To reelle bugs funnet og fikset via brukerens DevTools-skjermbilder: manglende CORS-header hos Sportmonks (rutet gjennom eksisterende dev-proxy) og falske positive på nummererte søsterkanaler (lagt til nummer-sperre i matchingen). Bekreftet fungerende av bruker på minst én kamp.
