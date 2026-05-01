# Deploy to a Hetzner CX22 (Option A — frontend only)

This deploys the Vite `dist/` build behind Caddy with automatic HTTPS via
Let's Encrypt. The backend stays on Lovable Cloud — no changes there.

Estimated time: **10 minutes** (after DNS propagates).

---

## 0. Prerequisites

- A domain you control (e.g. `app.example.com`). DNS managed somewhere
  you can edit A / AAAA records.
- A Hetzner Cloud account.

---

## 1. Create the server

1. Hetzner Cloud Console → **Add Server**.
2. **Location:** Ashburn (`ash`) or Hillsboro (`hil`) — closest to Kalshi's
   US-east API. Avoid EU regions; they add ~80 ms per signed request.
3. **Image:** Ubuntu 24.04.
4. **Type:** **CX22** (€4.51/mo, 2 vCPU / 4 GB / 40 GB).
5. **Networking:** keep IPv4 + IPv6 (both free).
6. **SSH key:** add yours (paste `~/.ssh/id_ed25519.pub`).
7. **Firewall:** create one allowing inbound **22, 80, 443** (TCP) and
   **443/UDP** (for HTTP/3). Restrict 22 to your IP if possible.
8. **Backups:** optional (+20% cost). Not critical for Option A — the only
   state on the box is the Let's Encrypt cert, which auto-renews.
9. Create. Note the **public IPv4** (e.g. `5.78.123.45`) and **IPv6**.

---

## 2. Point your domain at the server

At your DNS provider, add:

| Type  | Name              | Value             | TTL |
|-------|-------------------|-------------------|-----|
| A     | `app` (or `@`)    | `<HETZNER_IPV4>`  | 300 |
| AAAA  | `app` (or `@`)    | `<HETZNER_IPV6>`  | 300 |

Wait until `dig app.example.com` returns the Hetzner IP before continuing
— Caddy's first cert request will fail otherwise.

---

## 3. SSH in and install Docker

```bash
ssh root@<HETZNER_IPV4>

# Create a non-root user (recommended)
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
exit

ssh deploy@<HETZNER_IPV4>

# Docker + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version && docker compose version
```

---

## 4. Get the code on the box

Easiest: push this repo to GitHub (Lovable's GitHub integration), then:

```bash
git clone https://github.com/<you>/<repo>.git ~/app
cd ~/app
```

Or `scp -r` the project from your laptop.

---

## 5. Configure environment

Create `~/app/.env`:

```bash
cat > ~/app/.env <<'EOF'
DOMAIN=app.example.com
ACME_EMAIL=you@example.com

# Lovable Cloud (Supabase) — copy from this project's .env
VITE_SUPABASE_URL=https://jtnavdckhywnntjnrjbu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0bmF2ZGNraHl3bm50am5yamJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTM0NjcsImV4cCI6MjA5MzA4OTQ2N30.X7kcI4MWp9-SYHp5g8PgNwNd6G6KVzbo472dAbEl-Oc
VITE_SUPABASE_PROJECT_ID=jtnavdckhywnntjnrjbu
EOF
chmod 600 ~/app/.env
```

The `VITE_*` values are public (anon key) and are baked into the bundle
at build time — same as Lovable's hosted preview.

---

## 6. Build and start

```bash
cd ~/app
docker compose up -d --build
docker compose logs -f web
```

First boot Caddy will request a Let's Encrypt cert — you'll see lines
like `certificate obtained successfully`. After ~30 s:

```bash
curl -I https://app.example.com
# Expect: HTTP/2 200, with all the security headers
```

---

## 7. Update Google OAuth + Lovable Cloud Auth

Sign-in will break until you add the new domain to both:

1. **Google Cloud Console** → APIs & Services → Credentials → your OAuth
   client → **Authorized redirect URIs**, add:
   ```
   https://jtnavdckhywnntjnrjbu.supabase.co/auth/v1/callback
   ```
   (already there if you set it up before — no change needed; Google
   only cares about the Supabase callback, not your frontend domain.)

2. **Lovable Cloud → Users → Auth Settings → URL Configuration**:
   - **Site URL:** `https://app.example.com`
   - **Additional Redirect URLs:** add `https://app.example.com/**`

---

## 8. Updating the app later

Lovable doesn't auto-deploy to Hetzner. To ship a new build:

```bash
cd ~/app
git pull
docker compose up -d --build
```

Or set up a GitHub Action that SSHes in and runs the same commands on
every push to `main`. Ask if you want that workflow file generated.

---

## 9. Operational tips

- **Logs:** `docker compose logs -f web`
- **Cert renewal:** automatic, no cron needed. Caddy renews ~30 days
  before expiry.
- **Rebuild from scratch:** `docker compose down && docker compose up -d --build`
- **Disk usage:** `docker system prune -af` monthly to clear old images.
- **Firewall sanity check:** `sudo ss -tlnp` — only sshd, and Docker on
  80/443 should be listening.
- **Unattended upgrades:** `sudo apt install unattended-upgrades` for
  automatic OS security patches.

---

## 10. Rollback to Lovable hosting

Nothing on Lovable's side changed — `https://k15mamm.lovable.app` and
`https://k15mamm.webpwa.io` keep working. Just point DNS back if you
want to abandon the VPS.
