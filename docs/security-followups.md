# Security follow-ups intentionally NOT shipped

These items appeared in the security enhancement spec but were not implemented
because shipping them as written would either break working code or provide
only a false sense of security. Tracked here so we don't lose them.

## 1. Replacing the credential vault with `SecureCredentialManager`

**Why skipped:** The project already has a stronger implementation in
`src/lib/security/vault.ts`:

- AES-GCM 256-bit, PBKDF2-SHA256 with 250,000 iterations
- Passphrase-gated; passphrase cached only in `sessionStorage`
- Idle auto-lock via `src/lib/security/useIdleLock.ts` (configurable,
  default 15 min) wipes the in-memory PEM and pauses the bot
- Only the encrypted blob is persisted; non-secret metadata (keyId, env,
  proxy) is stored in plaintext so the unlock UI can render

The spec's `SecureCredentialManager` generates an AES key with
`crypto.subtle.generateKey` but never explains where the key itself is
stored — if it goes back into `localStorage` or `sessionStorage`, the
ciphertext is trivially decryptable by any XSS. The current vault avoids
that pitfall by deriving the key from a user-supplied passphrase that
never touches storage.

**To revisit:** if/when we add WebAuthn (see below) we can wrap the vault
passphrase with a platform authenticator instead of typing it.

## 2. Parallel client-side rate limiter

**Why skipped:** Kalshi traffic already flows through:
- `src/lib/kalshi/spotPoll.ts` — centralised, rate-limit aware spot poller
- `supabase/functions/kalshi-proxy/index.ts` — server-side proxy that
  honours Kalshi's 429s and backs off
- `src/lib/scheduler/loop.ts` — single-flight tick loop

Adding a second window-based limiter on top would either (a) double-throttle
the bot and miss quote refreshes, or (b) get out of sync with Kalshi's real
limits. If we want richer pacing we should extend the existing scheduler,
not bolt on a parallel limiter.

## 3. Parallel `RiskManager` with USD position caps

**Why skipped:** The app trades Kalshi cents-denominated binary contracts,
not USD spot. Risk is enforced by:
- `RiskLimits` in `src/lib/store.ts` (per-market position cap, global $
  exposure cap, daily stop-loss, optional auto-flatten, collateral safety %)
- `src/lib/strategy/collateral.ts` — pre-trade collateral check
- `src/components/mm/PreStartSimulation.tsx` — blocks Start when worst-case
  reserved collateral exceeds the safety threshold
- `RiskPanel` UI for live editing

A second risk manager would conflict with these. Any new limits should
extend `RiskLimits` and the existing pre-trade check.

## 4. SRI on `https://t.flock.com/track.js`

**Why skipped:** That script isn't in this project. The only third-party
script we load is `https://cdn.gpteng.co/...` which is Lovable's editor
runtime — its hash changes on Lovable's release cadence, so SRI would
break the editor preview. If we add other third-party scripts later we
should ship SRI with them.

## 5. WebAuthn registration

**Why skipped:** WebAuthn requires a server-side challenge generator and
credential store to be meaningful — a purely client-side implementation
stores the credential id in `localStorage`, which any XSS can read or
overwrite. We'd need a Supabase edge function + `webauthn_credentials`
table to do this properly.

**To revisit:** worth doing once we move beyond a single-allowed-email
private beta, since it would replace the OTP-by-email flow with a much
stronger second factor.

## 6. CSP `report-uri` / `report-to`

**Why skipped:** Would require an always-on edge function endpoint to
receive reports and storage to persist them. Reasonable to add when we
have a real CSP we want to monitor (i.e. once `'unsafe-inline'` is gone).

## 7. Server-set security headers from `vite.config.ts`

**Why skipped:** `vite.config.ts` only configures the dev server. The
production headers live in `public/_headers` (Netlify / Cloudflare
Pages format). If the production host doesn't read that file, we'd need
to set them at the CDN/edge.
---

## Audit remediation (2026-04-30)

Implemented from the "Kalshi 15-Minute Bitcoin AMM" audit report:

1. **Headers / CSP** — `public/_headers` upgraded: HSTS to 2 years,
   Cross-Origin-Embedder-Policy: credentialless, `interest-cohort=()`,
   `upgrade-insecure-requests`, dropped `unsafe-eval` from prod CSP, and
   added explicit no-cache directives for `/sw.js` and the manifest.
2. **Compression + chunking** — `vite-plugin-compression` (gzip + br) and
   `manualChunks` for react / recharts / react-query. Terser with
   `drop_console` in production.
3. **Service worker** — `public/sw.js`: app-shell only (HTML
   NetworkFirst, hashed assets cache-first). **Never caches** Kalshi /
   Coinbase / Supabase / proxy responses. Registration in `src/main.tsx`
   is gated against iframes and Lovable preview hosts so the editor
   keeps working.
4. **Circuit breaker** — `RiskLimits.maxLossPerMinuteDollars` enforced
   in `src/lib/scheduler/loop.ts` against a rolling 60s peak of
   `pnlHistory`; trips the kill switch (and optionally flattens) when
   exceeded. Editable from `RiskPanel`.

Explicitly **not** adopted from the audit (would regress security or
correctness):

- Replacing the encrypted vault with `localStorage`-backed credentials.
- Replacing the Kalshi proxy/RSA-PSS signer with a `Bearer` token client.
- Direct browser WebSocket to `api.kalshi.com` (would leak creds and
  bypass the proxy).
- A parallel `RiskManager15M` duplicating `RiskLimits` and the scheduler.
- Caching Kalshi REST responses in the service worker (stale trading
  data is dangerous).
