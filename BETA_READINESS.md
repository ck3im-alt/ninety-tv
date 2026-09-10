# Ninety V1 beta readiness

Operational checklist audited 2026-09-10. This is not legal advice or evidence of legal review. It does not authorize a deployment, Stripe verification, or live-mode changes.

## Architecture and public routes

The Samsung TV app collects feature-detected device metadata and creates a short-lived pairing session with `ninety-api`. Its QR opens `https://ninety.tv/pair/<token>`. `ninety-web` authenticates through Supabase, claims the TV, and can temporarily hand an M3U/Xtream URL to it. The API/Postgres service owns accounts, HMAC device fingerprints, legal acceptances, trials, device credentials, Stripe state, and entitlement. The TV persists only its revocable credential and its own local playlist configuration; it fails closed when entitlement cannot be verified.

Stable Web routes: `/terms`, `/privacy`, `/auth/callback`, `/account`, and `/pair/<token>`. Public API routes required for operation: `/health`, `/api/pairing/*`, `/api/device/entitlement`, `/api/account/*`, plus `/api/billing/webhook` only when billing is enabled.

## Configuration inventory

The canonical legal IDs for this beta code line are `terms-v1` and `privacy-v1`. Set them identically in API and Web. The pairing page compares the API-returned IDs with its displayed documents and refuses acceptance on drift.

### REQUIRED BEFORE E2E

Railway / `ninety-api`:

- `DATABASE_URL` — Railway Postgres connection; never reuse it as `TEST_DATABASE_URL`.
- `NODE_ENV=production`
- `CORS_ORIGINS=https://ninety.tv` — exactly the Web origin in production.
- `TRUST_PROXY_HOPS=1` — ordinary one-hop Railway public deployment.
- `PUBLIC_API_BASE_URL=https://<public Railway or custom API domain>`
- `PUBLIC_WEB_BASE_URL=https://ninety.tv`
- `SUPABASE_URL=https://<project-ref>.supabase.co` — issuer only; no service-role key.
- `DEVICE_IDENTIFIER_HMAC_SECRET=<independent random value of at least 32 characters>`
- `DEVICE_CREDENTIAL_DERIVATION_SECRET=<different random value of at least 32 characters>`
- `TERMS_VERSION=terms-v1`
- `PRIVACY_VERSION=privacy-v1`
- `FOOTBALLDATA_IO_TOKEN` — needed for fresh fixture and live-score behavior in a production-like Home test.

Web hosting / `ninety-web`:

- `NEXT_PUBLIC_WEB_BASE_URL=https://ninety.tv`
- `NEXT_PUBLIC_NINETY_API_URL=https://<same public API domain>`
- `NEXT_PUBLIC_SUPABASE_URL=https://<same project-ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable/anon browser key>`
- `NEXT_PUBLIC_TERMS_VERSION=terms-v1`
- `NEXT_PUBLIC_PRIVACY_VERSION=privacy-v1`

TV build / `ninety-tv`:

- `VITE_NINETY_API_URL=https://<same public API domain>` — production builds reject missing, HTTP, or path-bearing values.
- `VITE_NINETY_APP_VERSION=0.1.0` is optional because the code fallback matches `package.json` and `config.xml`; set it explicitly for release traceability.

External prerequisites: deploy reviewed API/Web commits to HTTPS; enable Supabase email/password; configure Google and Apple credentials if their visible buttons remain in the beta; migrate a disposable Postgres and run the zero-skip API suite; sign and install the Tizen package on a supported physical TV.

### REQUIRED BEFORE SAMSUNG BETA SUBMISSION

- Replace Web placeholders with Christian-supplied values in `NEXT_PUBLIC_LEGAL_COMPANY_NAME`, `NEXT_PUBLIC_LEGAL_REGISTRATION_NUMBER`, `NEXT_PUBLIC_LEGAL_ADDRESS`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_LEGAL_JURISDICTION`, `NEXT_PUBLIC_TERMS_EFFECTIVE_DATE`, and `NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE`.
- Complete jurisdiction-specific consumer/privacy wording. A changed published document requires new `NEXT_PUBLIC_TERMS_VERSION`/`TERMS_VERSION` and/or `NEXT_PUBLIC_PRIVACY_VERSION`/`PRIVACY_VERSION` IDs in Web/API together.
- Make `https://ninety.tv/terms` and `/privacy` public and provide a real tester feedback/support route.
- Complete Seller Office company profile, application registration, supported countries and 2022+ model groups, screenshots/metadata, privacy URL, content-rating answers, pre-test, beta tester list, and beta activation-code process.
- Preserve the Samsung author certificate and password outside Git. Use a DUID-bound Samsung TV distributor certificate for direct-device testing; use the same author identity for the Seller Office upload.

### REQUIRED BEFORE PAID PUBLIC LAUNCH

- Set `NEXT_PUBLIC_LEGAL_VAT_NUMBER` and finalize legal entity/tax details, governing law, dispute route, liability cap, warranties, statutory cancellation/refund language, controller identity, supervisory authority, retention schedule, subprocessors, transfer safeguards, and data-subject request process.
- Stripe business verification, live recurring Price, live secret handling, live webhook, Customer Portal, tax/invoice settings, and an explicitly authorized live-mode E2E.
- Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID` together. Partial configuration prevents API startup.

### OPTIONAL

- `INTERNAL_API_KEY` enables authenticated `/internal/*` diagnostics; without it those endpoints fail closed.
- `PORT` is supplied by Railway; local default is `3000`.
- `EPG_FETCH_TIMEOUT_MS` defaults to `25000`.
- `NINETY_PLAN_LABEL` and `NEXT_PUBLIC_NINETY_PLAN_LABEL` default to `Ninety subscription`.
- `EPG_GRABBER_BASE_URL` is only for seeding/re-seeding global-sports EPG sources.
- `VITE_PERF_DIAGNOSTICS=1` is for diagnostic TV packages and must not be used for beta artifacts.
- `TEST_DATABASE_URL` is verification-only and must identify a disposable, migrated database.
- All Stripe values are deliberately optional for a free-trial-only beta. Checkout, Portal, cards, webhooks, and a Stripe trial are not required in that mode.

No localhost fallback survives a configured production build: API startup, Web build, and TV build validate their product-critical values. Localhost defaults remain development-only.

## Supabase dashboard

1. Auth > URL Configuration: set Site URL to `https://ninety.tv`.
2. Add exact Redirect URLs `http://localhost:3001/auth/callback` and `https://ninety.tv/auth/callback`. Do not use a wildcard for production.
3. Ensure confirmation email templates use the supplied redirect target (`{{ .RedirectTo }}`) so signup returns through `/auth/callback?next=...` to the scanned pairing.
4. Enable email/password. Configure Google and Apple under Auth Providers. In each provider console register Supabase's callback `https://<project-ref>.supabase.co/auth/v1/callback`.
5. Give Web only the project URL and publishable browser key. Give API only the project URL. Ninety requires no Supabase service-role key.
6. Test Google, Apple, email/password, and email confirmation from a fresh `/pair/<token>`. The callback exchanges a one-time PKCE code server-side, validates `next` as a same-origin relative path, and stores access/refresh tokens in cookies—not URL parameters.

Current flow preservation is implemented by `safeReturnPath`, the auth forms' encoded `next`, `/auth/callback`, and the Supabase SSR proxy refresh. See [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Stripe sandbox (skip for trial-only beta)

1. Stay in test mode. Create one recurring Ninety Price and configure Customer Portal cancellation/payment-method behavior. Do not begin business verification or touch live mode without Christian's authorization.
2. Set the three API Stripe variables together.
3. Add `https://<public-api-domain>/api/billing/webhook` and subscribe to `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`, and `invoice.payment_failed`.
4. Test Checkout reuse/concurrency, the one-subscription invariant, Portal, cancellation, failed payment, and recovery. Keep Stripe's sandbox “Limit customers to 1 subscription” enabled.
5. Do not configure a second Stripe trial. Checkout anchors billing to the existing active Ninety trial. The success redirect never grants access; webhook handling fetches the current authoritative Subscription before persisting state.

See [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks).

## Railway

1. Attach Postgres and set the required API variables. Generate the two device secrets independently and preserve them from the first real pairing; rotation breaks fingerprint/credential continuity.
2. Generate a public HTTPS API domain and copy its origin to API, Web, and TV configuration.
3. Deploy later from reviewed commits. `railway.json` keeps the established Nixpacks builder, runs `npm run migrate up` before deployment, starts `npm start`, and health-checks `/health`. Migration `1755001700000_predeployment-account-hardening.sql` must appear applied.
4. Confirm `GET /health` returns `{"ok":true}`, CORS is emitted only for `https://ninety.tv`, and one trusted proxy hop reports the external HTTPS protocol/client address.
5. Confirm the pairing cleanup scheduler starts. Inspect logs during a disposable pairing: raw QR tokens, playlist/provider values, DUID, and MAC must not appear.

Railway terminates public TLS; Fastify trusts exactly one forwarded hop by default. Database TLS is enabled for non-local `DATABASE_URL`. See [Railway deployment configuration](https://docs.railway.com/config-as-code/reference). Railway currently marks Config as Code for future retirement; migrate formats in a separate post-beta change, not during this test.

## Samsung

1. Build without diagnostics and inspect the unsigned widget: app/package IDs, version `0.1.0`, Tizen floor `6.5` (2022 model year), ProductInfo/network/internet/tvinput privileges, `$WEBAPIS/webapis/webapis.js`, and root `config.xml`.
2. Direct-device qualification: register the TV DUID in the distributor certificate, sign with the documented `ninety-tv` profile, install, reboot, and complete `docs/TIZEN-HARDWARE-QUALIFICATION.md`.
3. Seller Office: preserve the author identity, upload the Seller Office package, run pre-test, select supported 2022+ groups/countries, submit a closed beta, and distribute issued one-time activation codes.

ProductInfo is optional at runtime and all calls remain feature-detected/try-caught; unavailable DUID must never mint a new trial. See [Samsung ProductInfo](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/productinfo-api.html) and [Seller Office beta testing](https://developer.samsung.com/tv-seller-office/faq/beta-test.html).

## Exact E2E procedure

1. Record API/Web/TV commit SHAs and signed-package hash. Verify `/health`, `/terms`, `/privacy`, deployed environment names, and matching legal IDs.
2. On a supported Samsung TV with Ninety application data removed, install the signed package and launch. Confirm safe identity collection, a QR, and no raw identifier in visible/log output.
3. Scan the QR on a logged-out phone. Sign up/in and confirm return to the exact `/pair/<token>`. Repeat separately for email/password, Google, and Apple. Try malicious `next` values (`//host`, absolute URL, backslash) and confirm fallback to `/account`.
4. Confirm TV metadata and review Terms/Privacy. Connect the TV. The one seven-day trial must start only now, use server time, and require no card. Confirm the TV observes the claim and persists its credential before ACK.
5. Send a disposable, authorized M3U/Xtream source; confirm import and Home. Repeat with “Not now.” If the phone closes before playlist completion, the TV must keep waiting until resume/skip or pairing expiry—not grant playback prematurely.
6. Make ProductInfo/DUID unavailable: linking may complete, but a new account receives `identity_unverified` and no trial. Existing eligible account entitlement may still cover the device.
7. Interrupt API access during session creation, polling, and entitlement validation. Confirm retry/wait UI and no playback. Let pairing expire and confirm a new QR/session is generated.
8. Restart the TV. Confirm its credential survives, entitlement is revalidated before playback, and Home then loads.
9. Remove the TV at `/account/devices`. On retry/restart or the next scheduled entitlement check, confirm access stops. API loss must remain fail-closed.
10. Reconnect the same account/TV and try the same physical TV with a second account. Neither may receive a second trial; a second TV on an active trial gets only remaining time.
11. Inspect database/log evidence: one trial per eligible account/DUID, accepted `terms-v1`/`privacy-v1`, hashed identifiers/credentials only, and consumed/expired pairing playlist data scrubbed.
12. Record TV model/year/firmware, network, timestamps, and every deviation.

## Rollback

Stop the test before rollback. Roll Web/API back to the previously verified deployment commits and reinstall the prior TV package using the same author identity. Do not rotate device secrets as a rollback. Migrations are forward-only; do not manually down-migrate production during an incident. Preserve relevant logs and opaque account/pairing IDs without copying secrets. Never roll a legal document independently of its API-accepted version.

## Go/no-go

The code can be release-candidate ready after all automated checks pass, but the system is **NOT READY for a real Samsung E2E until** every REQUIRED BEFORE E2E value is set in the external environments, the zero-skip disposable-Postgres suite passes, API/Web are deployed to HTTPS, and a Samsung-signed package is installed. Final company/legal facts and Stripe are not blockers for a private trial-only engineering E2E; they become blockers at the stages classified above.
