
# Kalshi BTC Automated Market Maker (Avellaneda–Stoikov)

A web-based control panel + backend bot that quotes both sides of Kalshi's hourly Bitcoin price-range markets using the Avellaneda-Stoikov model, runs against the **demo** environment, and gives you full risk controls + a kill switch.

## Architecture

- **Frontend (Lovable)**: dashboard to configure, monitor, start/stop the bot.
- **Lovable Cloud (Supabase)**: stores config, API credentials (encrypted), positions, fills, P&L, and event logs.
- **Edge Functions**:
  - `kalshi-auth` — signs requests with your Kalshi RSA private key (KEY ID + PEM).
  - `mm-tick` — the quoting loop: pulls BTC spot, fetches order book, computes A-S quotes, places/cancels orders, enforces risk.
  - `mm-control` — start/stop/kill-switch, manual flatten.
  - `mm-sync` — polls fills & positions from Kalshi, updates DB.
- **Scheduler**: a `pg_cron` job invokes `mm-tick` every N seconds (configurable, default 5s) while the bot is "running".

## Onboarding (credentials)

Settings page where you paste:
- Kalshi **API Key ID** (UUID)
- Kalshi **RSA private key** (PEM, the "Kalshi DSK")
- Environment locked to **demo** (`https://demo-api.kalshi.co/trade-api/v2`) with a clearly disabled "Production" toggle for later.

Stored as Lovable Cloud secrets, never exposed to the browser. A "Test connection" button calls `/portfolio/balance` to verify.

## Strategy: Avellaneda–Stoikov

For each selected hourly BTC market (e.g. `KXBTCD-25APR2217-T...`):

1. **Fair value `p`**: probability the strike is hit, computed from live BTC spot (Coinbase public ticker, no key needed) + time-to-expiry + a configurable volatility input, via a lognormal model.
2. **Reservation price**: `r = p − q · γ · σ² · (T−t)` where `q` = current contract inventory.
3. **Optimal half-spread**: `δ = γ · σ² · (T−t)/2 + (1/γ)·ln(1 + γ/k)`.
4. **Quotes**: bid = `r − δ`, ask = `r + δ`, clipped to Kalshi's 1¢–99¢ tick grid and to the best book ± a min-edge.
5. Re-quote each tick: cancel stale, place new, only if moved by > threshold (to limit API calls).

Tunable parameters (UI sliders): `γ` (risk aversion), `σ` (vol), `k` (order-flow intensity), tick interval, min edge, max quote size.

## Risk controls (all v1)

- **Per-market position cap** (contracts) and **global $ exposure cap**.
- **Max order size** per quote.
- **Inventory skew** is built into A-S (reservation price shifts).
- **Daily P&L stop-loss**: auto-pauses bot, cancels all orders, optionally flattens.
- **Kill switch button**: cancels all open orders + (optional) market-flatten positions, disables scheduler.
- **Heartbeat watchdog**: if `mm-tick` hasn't run in >30s, dashboard shows red.

## Dashboard UI

- **Status header**: Running/Paused/Killed, env badge (DEMO), account balance, total exposure, day P&L, heartbeat.
- **Big red Kill Switch** + Start/Pause buttons.
- **Markets panel**: list of active hourly BTC events; checkbox to enable/disable quoting per ticker; shows fair value, our bid/ask, book best bid/ask, position, unrealized P&L.
- **Strategy panel**: sliders for γ, σ, k, spread floor, max size, tick interval.
- **Risk panel**: inputs for position caps, $ cap, daily stop-loss; toggle "auto-flatten on stop".
- **Activity log**: live stream of quotes, fills, cancels, errors.
- **P&L chart**: cumulative realized + unrealized over the session.

## Data model (Supabase)

- `bot_config` (singleton): strategy params, risk limits, run state.
- `tracked_markets`: event/market tickers + per-market overrides.
- `quotes`: every quote placed (ticker, side, price, size, ts, order_id, status).
- `fills`: executions from Kalshi.
- `positions`: current net contracts per market (refreshed from Kalshi).
- `pnl_snapshots`: minute-by-minute equity curve.
- `events_log`: structured logs (info/warn/error) for the activity feed.

## Out of scope for v1 (can add later)

- Production environment toggle.
- Multi-user / auth (single-operator app).
- Hedging on a real BTC venue.
- Backtesting harness.

## What you'll need to provide after approval

- Kalshi demo **API Key ID**
- Kalshi demo **RSA private key (PEM)**

Both pasted once into the Settings page; stored as encrypted Lovable Cloud secrets and only read inside edge functions.
