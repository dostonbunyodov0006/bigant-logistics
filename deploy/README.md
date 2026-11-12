# Deploying BIGANT Logistics

Single-box deployment: Postgres, the NestJS API, and nginx serving the dashboard,
behind Cloudflare.

```
browser / mobile APK
        |  https://your-domain.uz
        v
   Cloudflare (proxied)          <- public TLS, WAF
        |  https, Full (strict)
        v
   nginx  :443                   <- Cloudflare Origin CA cert
    |          \
    |           \ /api/*  ->  backend :3000  ->  postgres :5432
    +-- static dashboard
```

## Why the stack looks like this

**One backend instance, not eight.** `RealtimeService` broadcasts over an
in-process rxjs `Subject`, so SSE clients only receive events published by the
instance they are connected to. A second replica would silently show stale
boards to half the users, and the polling fallback was removed. The eight cores
go to Postgres and headroom. `WORKER_ENABLED` is the hook for splitting the
dispatchers out later; Redis pub/sub is the missing piece for multi-instance SSE.

**No Redis.** Nothing in the codebase connects to it, and the unused
`REDIS_URL` setting has been dropped.

**Same-origin API.** The dashboard is served from the same host as `/api`, so no
browser makes a cross-origin request, `CORS_ORIGINS` stays empty, and the SSE
`?token=` never crosses hosts.

**Neither Postgres nor the API publishes a host port.** Only 80/443 are exposed.

## First deployment

### 1. Prerequisites on the server

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh

# Only 80, 443 and SSH reach the box
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
```

### 2. Certificates

The Cloudflare Origin CA certificate for `your-domain.uz`:

```bash
mkdir -p /etc/bigant/certs && chmod 700 /etc/bigant/certs
# origin.pem = the certificate, origin.key = the private key
chmod 600 /etc/bigant/certs/origin.key
```

Then in Cloudflare set **SSL/TLS → Overview → Full (strict)**. An Origin CA cert
is trusted by Cloudflare only; on *Flexible* the Cloudflare→origin leg would be
plaintext, and on *Off* there would be no TLS at all.

### 3. Configuration

```bash
cd /opt/bigant/logistics
cp deploy/.env.prod.example deploy/.env.prod
chmod 600 deploy/.env.prod
openssl rand -hex 32   # once per secret: POSTGRES_PASSWORD, JWT_*_SECRET
```

Credential files go in `SECRETS_DIR`, mounted read-only at `/run/secrets`:

```bash
mkdir -p /etc/bigant/secrets && chmod 700 /etc/bigant/secrets
# scp the Firebase service account here, then:
chmod 600 /etc/bigant/secrets/firebase-service-account.json
```

Leaving the integration variables empty is safe but **silent**: Telegram sends
and push notifications are logged instead of delivered, and uploads return a
placeholder URL. Confirm they are live from the boot log (step 6). The same goes
for `OPENAI_API_KEY`: without it the fuel log works and drivers type the
dispenser numbers; the boot log says `OPENAI_API_KEY not set`.

`docker-compose.prod.yml` forwards variables to the backend **by name**, so a
new variable in `.env.prod` does nothing until it is also listed under the
service's `environment:`. That is deliberate — the container gets exactly the
variables the code reads — but it is the first thing to check when a setting
"does not take".

### 4. Bring it up

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

Migrations run automatically — the backend image's `CMD` is
`prisma migrate deploy && node dist/main.js`.

### 5. Seed the first admin

Only for a brand-new database:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec backend pnpm db:seed
```

### 6. Verify

```bash
curl -sf https://your-domain.uz/api/health/ready     # {"status":"ok","database":"up"}
curl -sI https://your-domain.uz/ | head -1           # 200
curl -si https://your-domain.uz/api/docs | head -1   # 404 — disabled in production
```

Check SSE is not being buffered anywhere — this must print events, not hang:

```bash
TOKEN=$(curl -s -X POST https://your-domain.uz/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone_number":"+998...","password":"..."}' | jq -r .access_token)
curl -N "https://your-domain.uz/api/realtime/stream?token=$TOKEN"
# a ping every 25s = the stream is alive end to end
```

That 25s heartbeat is what keeps the connection under Cloudflare's ~100s idle
timeout (error 524).

## Updating

The server pulls over SSH with its own **read-only deploy key**
(`/root/.ssh/github_deploy`, registered on the repo as "bigant production
server"). It is read-only on purpose: the server should never be able to push,
and a key that can only read is safe to leave on a box that faces the internet.
No personal access token is stored anywhere on the server — verified.

```bash
cd /opt/bigant && git pull --ff-only origin main
cd logistics

# Rebuild only what changed, and --no-deps so a web-only deploy does not
# restart the API (see below).
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  up -d --build --no-deps backend    # backend or shared/ changes
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  up -d --build --no-deps web        # dashboard changes
```

Rebuilding `web` is required for any dashboard change: `VITE_API_URL` and the
whole bundle are compiled at image build time.

**Why `--no-deps` matters.** `web` depends on `backend`, and the backend image
is built from `COPY . .` over the whole monorepo — so *any* file change produces
a new backend image. Without `--no-deps`, a web-only deploy rebuilds and
recreates the API too, for a ~15 s outage that changes nothing.

Migrations run themselves: the backend image's `CMD` is
`prisma migrate deploy && node dist/main.js`.

After a backend deploy, confirm the routes you expect are actually there:

```bash
docker logs bigant-backend-1 2>&1 | grep -oE "Mapped \{/[a-z/:.-]+, (GET|POST|PATCH|DELETE)\}" | sort -u
```

### If the deploy key is ever lost

Regenerate on the server and re-register; nothing else changes.

```bash
ssh-keygen -t ed25519 -N "" -C "bigant-server-deploy-ro" -f /root/.ssh/github_deploy
cat /root/.ssh/github_deploy.pub    # add at Settings → Deploy keys, WITHOUT write access
```

`/root/.ssh/config` pins that key to `github.com` with `IdentitiesOnly yes`, so
it is never offered to another host, and GitHub's host keys are in
`/root/.ssh/known_hosts` rather than trusted on first use.

## Map tiles

The dashboard's basemap is one PMTiles archive of Uzbekistan served as a static
file. There is no tile server: nginx hands out byte ranges and MapLibre reads
the tiles it needs out of the archive.

Built from the same OSM extract Valhalla routes on, so nothing extra is
downloaded:

```bash
mkdir -p /opt/bigant-geo/tiles
cp /opt/bigant-geo/valhalla/data-current/uzbekistan-*.osm.pbf \
   /opt/bigant-geo/tiles/uzbekistan.osm.pbf

docker run --rm -v /opt/bigant-geo/tiles:/data -e JAVA_TOOL_OPTIONS=-Xmx8g \
  ghcr.io/onthegomap/planetiler:latest \
  --osm-path=/data/uzbekistan.osm.pbf --output=/data/uzbekistan.pmtiles \
  --download --force
```

About four minutes and ~164 MB for z0–14. `--download` fetches planetiler's own
auxiliary data (Natural Earth, water polygons) the first time.

Label glyphs are a separate 34 MB, and the style names one face:

```bash
curl -fL -o /tmp/fonts.zip \
  https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-sans.zip
python3 -c "import zipfile,pathlib; z=zipfile.ZipFile('/tmp/fonts.zip'); \
  d=pathlib.Path('/opt/bigant-geo/tiles/fonts'); d.mkdir(parents=True,exist_ok=True); \
  [z.extract(n,d) for n in z.namelist() if n.startswith('Noto Sans Regular/')]"
```

`TILES_DIR` in `.env.prod` points nginx at that directory (mounted read-only at
`/srv/tiles`). Verify after a deploy:

```bash
curl -sI https://your-domain.uz/tiles/uzbekistan.pmtiles | grep -i accept-ranges
curl -s -o /dev/null -w '%{http_code}\n' -H 'Range: bytes=0-16' \
  https://your-domain.uz/tiles/uzbekistan.pmtiles    # 206
```

**Refreshing:** re-run planetiler against a newer extract. The archive is
replaced in place and browsers pick it up on their next load — the nginx rule
caches it for 30 days, so bump the filename (and `TILES` in
`apps/web/src/lib/mapStyle.ts`) if you need it sooner than that.

Why not raster tiles: a mapnik/PostGIS renderer is a second database, a render
daemon and a growing cache to maintain, and its output is light — which reads
as a mistake inside the seller board's dark panel. Vector costs one file and
lets the same archive serve a light console and a dark board.

## Backups

```bash
install -m 700 deploy/scripts/backup.sh /usr/local/bin/bigant-backup
mkdir -p /var/backups/bigant

# `|| true` matters: on an empty crontab, grep exits 1, and under `set -e` that
# aborts the subshell so `crontab -` receives nothing and wipes the crontab.
{ crontab -l 2>/dev/null | grep -v bigant-backup || true
  echo '15 2 * * * /usr/local/bin/bigant-backup >> /var/log/bigant-backup.log 2>&1'
} | crontab -
crontab -l   # confirm the line is actually there
```

02:15 UTC = 07:15 Tashkent. The dump is written under a `.partial` name, checked
with `gzip -t` and a size floor, and only then renamed — so a run interrupted
half-way cannot be mistaken for a good backup. Old dumps are pruned only after a
run succeeds, so a failing backup never deletes the last good one.

Three settings in `.env.prod` decide whether this is really a backup:

| | |
|---|---|
| `OFFSITE_TARGET` | rsync destination off this host. **Unset means the dumps sit on the same disk as the database they protect** — that covers a dropped table, not a lost server. |
| `OFFSITE_SSH_KEY` | key for that destination |
| `PING_URL` | pinged on success, `$PING_URL/fail` on failure. The failure worth catching is the backup quietly stopping, which only something expecting a regular ping can notice. |

Restore:

```bash
gunzip -c /var/backups/bigant/bigant-<stamp>.sql.gz | docker compose \
  -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec -T postgres psql -U bigant -d bigant_logistics
```

## Mobile APK

`apps/mobile` reads the API base from `expoConfig.extra.apiUrl`, which
`app.config.js` fills in: production by default, and `http://localhost:3000`
for `expo start` and debug builds via the committed `.env.development`. Set the
variable explicitly on a release build rather than trusting `NODE_ENV`:

```bash
EXPO_PUBLIC_API_URL=https://your-domain.uz/api pnpm --filter @bigant/mobile exec \
  expo run:android --variant release
```

Confirm what actually got compiled in before shipping the APK:

```bash
NODE_ENV=production pnpm --filter @bigant/mobile exec expo config --type public --json \
  | jq -r .extra.apiUrl
```

It is compiled in — a new URL means a new APK. Keep the signing keystore safe:
lose it and installed apps can no longer be updated, only uninstalled and
reinstalled.

## Monitoring

```bash
install -m 700 deploy/scripts/monitor.sh /usr/local/bin/bigant-monitor
{ crontab -l 2>/dev/null | grep -v bigant-monitor || true
  echo '*/5 * * * * /usr/local/bin/bigant-monitor >> /var/log/bigant-monitor.log 2>&1'
} | crontab -
crontab -l
```

Checks disk, memory, every expected container, backup freshness, and that the
API answers. Alerts go to Telegram (`TELEGRAM_OPS_CHAT_ID`, falling back to the
work group) on the **transition** into a bad state and again on recovery — an
alert that repeats every five minutes is an alert people mute.

**This runs on the box, so it cannot tell you the box is down.** That needs a
check from somewhere else hitting `https://your-domain.uz/api/health/ready`
every minute — any of the free uptime services will do, and it is the one piece
of monitoring that cannot live here.

State lives in `/var/lib/bigant-monitor`; delete a `*.failing` file to make the
next run re-alert.

## Operations

```bash
# logs
docker compose -f deploy/docker-compose.prod.yml logs -f backend

# state
docker compose -f deploy/docker-compose.prod.yml ps

# psql
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec postgres psql -U bigant -d bigant_logistics
```

`deploy/postgres/postgresql.conf` is passed as `config_file=`, which **replaces**
the config initdb generated — so it must carry runtime settings too, not just
tuning (note `listen_addresses`). Its `timezone` must stay `UTC`: the application
derives Tashkent time itself in `common/tashkent-time.ts`, and a non-UTC server
timezone would double-apply the +5 offset and corrupt attendance date keys.
