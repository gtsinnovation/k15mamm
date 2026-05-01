# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Install deps with bun for parity with Lovable's build
RUN npm install -g bun@1.1.38

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

# Vite reads VITE_* at build time. The Lovable Cloud values are baked into
# the image; pass --build-arg to override for a different backend.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

RUN bun run build

# ---- Runtime stage: Caddy serves dist/ with auto-HTTPS ----
FROM caddy:2.8-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
