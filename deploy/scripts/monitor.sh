#!/usr/bin/env bash
# Tells you when something on the BIGANT box has gone wrong, over Telegram.
#
# Install (as root on the server):
#   install -m 700 deploy/scripts/monitor.sh /usr/local/bin/bigant-monitor
#   { crontab -l 2>/dev/null | grep -v bigant-monitor || true
#     echo '*/5 * * * * /usr/local/bin/bigant-monitor >> /var/log/bigant-monitor.log 2>&1'
#   } | crontab -
#   crontab -l   # confirm — grep exits 1 on an empty crontab, and under `set -e`
#                # that would abort the subshell and hand `crontab -` nothing
#
# This runs ON the box, so it cannot tell you the box is down — that needs an
# external check hitting /api/health/ready. What it covers is everything short
# of that: a service that died, a disk filling up, a backup that stopped.
#
# It alerts on the *transition* into a bad state and again on recovery, not
# every five minutes. An alert that repeats is an alert people mute.

set -uo pipefail

ENV_FILE=${ENV_FILE:-/opt/bigant/logistics/deploy/.env.prod}
STATE_DIR=${STATE_DIR:-/var/lib/bigant-monitor}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/bigant}

DISK_PCT_MAX=${DISK_PCT_MAX:-85}
MEM_MIN_MB=${MEM_MIN_MB:-1024}
BACKUP_MAX_AGE_H=${BACKUP_MAX_AGE_H:-36}
# Service names, not container names: a deploy starts the new backend beside
# the old one, so it may be bigant-backend-2, -3… — whichever runs is the one.
CONTAINERS=${CONTAINERS:-bigant-postgres bigant-backend bigant-web bigant-geo-photon bigant-valhalla-valhalla}

# Read single values rather than sourcing: the file is Compose-format, not
# shell, and an unquoted value with a space would execute as a command.
env_value() {
  [ -r "$ENV_FILE" ] || return 0
  grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/; s/^'\''\(.*\)'\''$/\1/'
}
BOT_TOKEN=$(env_value TELEGRAM_BOT_TOKEN)
DOMAIN=$(env_value DOMAIN)
CHAT_ID=$(env_value TELEGRAM_OPS_CHAT_ID)
[ -n "$CHAT_ID" ] || CHAT_ID=$(env_value TELEGRAM_GROUP_CHAT_ID)

mkdir -p "$STATE_DIR"
host=$(hostname)

notify() {
  local text="$1"
  echo "$(date -u +%FT%TZ) $text"
  if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
    echo "  (not sent: TELEGRAM_BOT_TOKEN / chat id missing from $ENV_FILE)" >&2
    return 0
  fi
  curl -fsS -m 15 -o /dev/null \
    --data-urlencode "chat_id=$CHAT_ID" \
    --data-urlencode "text=$text" \
    "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
    || echo "  (telegram send failed)" >&2
}

# Alert once when a check starts failing, once more when it recovers.
report() {
  local key="$1" ok="$2" detail="$3"
  local flag="$STATE_DIR/$key.failing"
  if [ "$ok" = "yes" ]; then
    if [ -e "$flag" ]; then
      rm -f "$flag"
      notify "✅ $host · $key recovered — $detail"
    fi
  else
    if [ ! -e "$flag" ]; then
      : > "$flag"
      notify "🔴 $host · $key — $detail"
    fi
  fi
}

# --- disk ------------------------------------------------------------------
# The one that takes everything with it: Postgres, the backups meant to save it,
# and the map tiles all share this volume.
pct=$(df --output=pcent / | tail -1 | tr -dc '0-9')
avail=$(df -h --output=avail / | tail -1 | tr -d ' ')
if [ "$pct" -ge "$DISK_PCT_MAX" ]; then
  report disk no "root filesystem ${pct}% full, ${avail} left (limit ${DISK_PCT_MAX}%)"
else
  report disk yes "${pct}% used, ${avail} free"
fi

# --- memory ----------------------------------------------------------------
mem_avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_avail" -lt "$MEM_MIN_MB" ]; then
  report memory no "only ${mem_avail} MB available (limit ${MEM_MIN_MB} MB)"
else
  report memory yes "${mem_avail} MB available"
fi

# --- containers ------------------------------------------------------------
# Health where the image declares a healthcheck, running state where it does
# not — `unless-stopped` restarts a crash, so what this catches is the crash
# loop and the container that stayed down.
for name in $CONTAINERS; do
  # The running one of name-1, name-2…; failing that, any of them, to report its state.
  cid=$(docker ps -q --filter "name=^${name}-[0-9]+$" | head -1)
  [ -n "$cid" ] || cid=$(docker ps -aq --filter "name=^${name}-[0-9]+$" | head -1)
  state=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo missing)
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)
  restarts=$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)
  key="container-$name"
  if [ "$state" != "running" ]; then
    report "$key" no "$state"
  elif [ "$health" = "unhealthy" ]; then
    report "$key" no "running but unhealthy"
  else
    report "$key" yes "running${restarts:+, $restarts restarts since creation}"
  fi
done

# --- backup freshness ------------------------------------------------------
# The dead-man's switch in backup.sh covers the run not happening at all; this
# covers the same thing from the inside, for when there is no external service.
newest=$(find "$BACKUP_DIR" -name 'bigant-*.sql.gz' -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
if [ -z "$newest" ]; then
  report backup no "no dump found in $BACKUP_DIR"
else
  age_h=$(( ( $(date +%s) - ${newest%.*} ) / 3600 ))
  if [ "$age_h" -gt "$BACKUP_MAX_AGE_H" ]; then
    report backup no "newest dump is ${age_h}h old (limit ${BACKUP_MAX_AGE_H}h)"
  else
    report backup yes "newest dump ${age_h}h old"
  fi
fi

# --- the API, from the inside ----------------------------------------------
# Not a substitute for an external check — this proves the app answers, not
# that anyone can reach it.
# Over TLS and with the real Host, and the status code is read rather than
# left to curl: port 80 answers every path with a 301, which `curl -f` counts
# as success — so the old check could not fail, whatever the API was doing.
api_code=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -k \
  "https://127.0.0.1/api/health/ready" -H "Host: ${DOMAIN:-localhost}" 2>/dev/null || echo 000)
if [ "$api_code" = 200 ]; then
  report api yes "health/ready answering"
else
  report api no "health/ready answered $api_code from the host"
fi
