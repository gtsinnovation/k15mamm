# K15M AMM

K15M AMM is a local-first automated market maker for Kalshi hourly BTC range
markets. It implements an Avellaneda–Stoikov style quoter and runs entirely
in your browser.

## How it works

1. Sign in with Google (multi-user — every account gets its own workspace).
2. Add your own Kalshi **API Key ID** (UUID) and **RSA private key** (PEM).
3. Choose a passphrase to encrypt the key locally with AES-GCM (PBKDF2-SHA256,
   250k iterations). The decrypted key only lives in memory while the vault
   is unlocked, and is wiped on idle auto-lock.
4. Configure strategy + risk parameters and start the bot.

## Backend

A thin Lovable Cloud edge function (`kalshi-proxy`) relays browser-signed
Kalshi requests to bypass CORS. It only verifies that the caller has a valid
authenticated session — it never sees your Kalshi private key.
