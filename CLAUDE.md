# Guidance for AI coding agents

This file captures constraints that are easy to violate with a well-intentioned
change, because the reasoning behind them lives in a product/legal/security
decision, not in the code itself. Read this before proposing changes in the
areas below. See the matching file in `ninety-api` for the backend half of
this.

## Product/legal: stay a neutral, bring-your-own-playlist client

Ninety never stores, discovers, or recommends specific IPTV/Xtream sources —
the user brings their own. This is a deliberate legal position, not a missing
feature:

- Do not add any feature that lists, shares, syncs, or suggests IPTV
  providers, M3U URLs, or "popular servers" — including a "community
  playlist" feature. This is the single biggest lever for accidentally
  crossing from "neutral player" (the Sony/Betamax "staple article of
  commerce" standard) into "facilitates infringement" territory (see *CJEU
  C-527/15, Stichting Brein v. Wullems / "Filmspeler"*, where a media player
  pre-configured with links to infringing streams — not the player itself —
  was what created liability).
- Do not build a stream proxy/relay/cache, here or in `ninety-api`. This app
  must only ever read the stream URL the user's own IPTV panel gives it,
  never re-host or transform stream bytes.
- Keep marketing copy/UI text neutral ("organize your IPTV playlist"), never
  implying free access to paid/premium content.

## Security: the QR pairing flow is a trust boundary — treat it like one

`usePairingSession` / `PlaylistSetupScreen` currently accept whatever
playlist URL arrives from `pollPairingStatus()` and persist it immediately
(tracked in issue #1). Until that's fixed:

- Don't extend the pairing flow to auto-persist anything without a
  user-visible confirmation step first. The QR code is visible to anyone near
  the screen for ~10 minutes, so "we received a URL" is not the same as "the
  owner sent it."
- Don't add a "remember last N pairing sources" convenience feature — it
  would widen the exposure window this issue is about to close.

## Security: never log or forward URLs containing Xtream credentials

Xtream Codes puts `username`/`password` directly in the URL — query string
*and* the `/live/<user>/<pass>/...` stream path (see
`src/data/xtream/xtreamClient.ts`). This is the protocol, not a bug, which
makes every Xtream URL in this codebase a secret:

- If you add crash reporting, analytics, or any third-party logging SDK,
  redact `username=`/`password=` (and the `/live/<user>/<pass>/` path form)
  from every URL before it leaves the device. Don't assume a vendor SDK does
  this for you — verify it, or write a redaction helper and use it everywhere
  a URL is logged (tracked in issue #4).
- Don't add a "share my playlist" or "export debug info" feature without the
  same redaction applied first.

## Security: local storage is deliberately unencrypted — know the actual reason

`src/data/session.ts` stores Xtream credentials in `localStorage` in
cleartext, on purpose (see the comment at the top of that file): there's no
OS keyring available to a web app, and any Web Crypto key would have to live
on the same origin anyway, so client-side encryption here would be
obfuscation, not real protection, given the assumed threat model (single-user
family TV). Don't "fix" this by adding encryption that doesn't change the
threat model — that's wasted complexity. Do fix the GitHub Pages deploy
target instead (issue #2), which changes the actual threat model, since it
currently shares a storage origin with unrelated projects on the same
`github.io` account.

## Where the full reasoning lives

GitHub issues: #1 (pairing confirmation), #2 (shared GitHub Pages origin), #3
(Referrer-Policy), #4 (credential-URL logging guideline).
