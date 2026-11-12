#!/usr/bin/env bash
# Hourly Postgres backup for BIGANT Logistics (owner, 07.11.2026: was nightly —
# a server lost in the afternoon took the whole day's orders with it).
#
# Install (as root on the server; its clock is Tashkent's):
#   install -m 700 deploy/scripts/backup.sh /usr/local/bin/bigant-backup
#   install -m 700 deploy/scripts/backup-report.sh /usr/local/bin/bigant-backup-report
#   install -m 700 deploy/scripts/restore.sh /usr/local/bin/bigant-restore
#   mkdir -p /var/backups/bigant
#   crontab -e   ->   5 * * * * QUIET=1 /usr/local/bin/bigant-backup >> /var/log/bigant-backup.log 2>&1
#                     30 2 * * * /usr/local/bin/bigant-backup-report >> /var/log/bigant-backup.log 2>&1
#
# QUIET=1: no Telegram line per run; the day's runs are told once, at 02:30, by
# backup-report.sh.
#
# IMPORTANT: this writes to the same machine that holds the database. That covers
# "someone deleted a table", not "the disk or the server is gone". Copy the
# dumps off this host as well (see OFFSITE below).

set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-/opt/bigant/logistics/deploy/docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-/opt/bigant/logistics/deploy/.env.prod}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/bigant}
RETENTION_DAYS=${RETENTION_DAYS:-14}
# rsync destination for the copy that leaves this host, e.g.
# backup@elsewhere:/backups/bigant/. Empty disables it — and leaves you with
# backups on the same disk as the database, which is not a backup.
OFFSITE_TARGET=${OFFSITE_TARGET:-}
OFFSITE_SSH_KEY=${OFFSITE_SSH_KEY:-/root/.ssh/backup_key}
# Where rclone keeps the Google Drive token and the crypt password. Root-only,
# and the password is written down in the owner's key folder as well — without
# it the copy in the cloud cannot be opened by anybody, including us.
RCLONE_CONF=${RCLONE_CONF:-/root/.config/rclone/rclone.conf}
# A dead-man's switch: a URL pinged on success. What matters is not a noisy
# failure but a backup that quietly stops happening, which only something
# expecting a regular ping can notice. `$PING_URL/fail` is pinged on failure so
# the alert arrives immediately rather than after the grace period.
PING_URL=${PING_URL:-}

# Read only the two values needed, rather than sourcing the file. Sourcing runs
# it as shell: an unquoted value containing a space (SEED_ADMIN_NAME=System Admin)
# executes the second word as a command, and Compose's own parser accepts that
# form happily, so the file is not necessarily shell-safe.
env_value() {
  grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/; s/^'\''\(.*\)'\''$/\1/'
}
POSTGRES_USER=$(env_value POSTGRES_USER)
POSTGRES_DB=$(env_value POSTGRES_DB)
MEDIA_DIR=$(env_value MEDIA_DIR)
MEDIA_DIR=${MEDIA_DIR:-/var/lib/bigant/media}

ping_switch() {
  [ -n "$PING_URL" ] || return 0
  curl -fsS -m 10 -o /dev/null "$1" || echo "warn: could not reach the dead-man's switch at $1" >&2
}
# Any failure below reports it, rather than waiting for the grace period. The
# FAIL line is what the 02:30 report counts.
trap 'echo "$(date -u +%FT%TZ) FAIL at line $LINENO" >&2; ping_switch "$PING_URL/fail"' ERR

if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_DB" ]; then
  echo "FAIL: POSTGRES_USER/POSTGRES_DB not found in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIR/bigant-$stamp.sql.gz"

# --clean --if-exists makes the dump restorable over an existing database.
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip -9 > "$target.partial"

# Only name it as a real backup once it is complete, so a run interrupted
# half-way cannot be mistaken for a good dump.
mv "$target.partial" "$target"

# Verify the archive is intact rather than trusting that the pipe succeeded.
gzip -t "$target"
size=$(stat -c %s "$target")
if [ "$size" -lt 1024 ]; then
  echo "FAIL: $target is only ${size}B — refusing to treat this as a backup" >&2
  exit 1
fi

echo "$(date -u +%FT%TZ) ok $target ($size bytes)"

# Prune old dumps only after this run succeeded, so a failing backup never
# deletes the last good one.
find "$BACKUP_DIR" -name 'bigant-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name '*.partial' -mtime +1 -delete

# --- Off-site --------------------------------------------------------------
# A dump beside the database survives a dropped table, not a lost disk.
if [ -n "$OFFSITE_TARGET" ]; then
  rsync -e "ssh -i $OFFSITE_SSH_KEY -o StrictHostKeyChecking=accept-new" \
    -az --timeout=300 "$target" "$OFFSITE_TARGET"
  echo "$(date -u +%FT%TZ) offsite $target -> $OFFSITE_TARGET"
  # Proof photos: incremental, so only the day's new files cross the wire. No
  # --delete — a photo removed here by mistake must survive in the copy.
  if [ -d "$MEDIA_DIR" ]; then
    rsync -e "ssh -i $OFFSITE_SSH_KEY -o StrictHostKeyChecking=accept-new"       -a --timeout=600 "$MEDIA_DIR/" "${OFFSITE_TARGET%/}/media/"
    echo "$(date -u +%FT%TZ) offsite $MEDIA_DIR -> ${OFFSITE_TARGET%/}/media/"
  fi
elif ! rclone --config "$RCLONE_CONF" listremotes 2>/dev/null | grep -q '^zaxira:'; then
  # Said only when there is no route off this disk at all. With Drive
  # configured below, the dump does leave the machine.
  echo "$(date -u +%FT%TZ) warn: no off-site route — this dump is on the same disk as the database" >&2
fi

# --- Off-site, the copy that is actually off the site ----------------------
# Google Drive, through rclone's `zaxira:` remote — a crypt layer over the
# drive, so neither the file names nor what is inside them is readable on
# Google's side. Fifteen free gigabytes, no card, and the photographs are
# already shrunk to about a third of a megabyte each on the way in.
#
# `copy`, never `sync`: nothing here deletes anything there. A photo removed
# on this disk by mistake stays in the copy, and so does a dump this script
# has pruned.
if rclone --config "$RCLONE_CONF" listremotes 2>/dev/null | grep -q '^zaxira:'; then
  if rclone --config "$RCLONE_CONF" copy "$target" zaxira:/baza/ --timeout 5m 2>&1; then
    echo "$(date -u +%FT%TZ) offsite $target -> Google Drive (shifrlangan)"
  else
    echo "$(date -u +%FT%TZ) warn: could not copy $target to Google Drive" >&2
  fi
  if [ -d "$MEDIA_DIR" ]; then
    # Only what is new crosses the wire; the rest is already there.
    rclone --config "$RCLONE_CONF" copy "$MEDIA_DIR" zaxira:/rasm/ --timeout 30m 2>&1 ||
      echo "$(date -u +%FT%TZ) warn: media copy to Google Drive did not finish" >&2
  fi
  # The server's own settings (owner, 07.11.2026): without .env.prod and the
  # secrets folder a new server cannot be brought up from the dump. Through the
  # same crypt layer, so they are unreadable on Google's side; one copy, replaced.
  SETTINGS_TAR=/root/.bigant-sozlama.tar.gz
  SECRETS_DIR=$(env_value SECRETS_DIR)
  SECRETS_DIR=${SECRETS_DIR:-/etc/bigant/secrets}
  if tar -czf "$SETTINGS_TAR" -C / "${ENV_FILE#/}" "${SECRETS_DIR#/}" "${RCLONE_CONF#/}" 2>/dev/null; then
    chmod 600 "$SETTINGS_TAR"
    rclone --config "$RCLONE_CONF" copyto "$SETTINGS_TAR" zaxira:/sozlama/sozlama.tar.gz --timeout 5m 2>&1 ||
      echo "$(date -u +%FT%TZ) warn: settings copy to Google Drive did not finish" >&2
  fi
fi

# --- A word to the office, never the data ----------------------------------
# The dump itself does not go to Telegram. It was, encrypted, for a while, and
# that was wrong: a chat is not a vault — the file sits on somebody else's
# servers, every person in the room can save it, and the database grows past
# what a chat will carry anyway. What goes out is a line saying the backup
# happened and how big it was; the copy belongs somewhere access is granted
# rather than shared.
BOT_TOKEN=$(env_value TELEGRAM_BOT_TOKEN)
OPS_CHAT=$(env_value TELEGRAM_OPS_CHAT_ID)
[ -n "$OPS_CHAT" ] || OPS_CHAT=$(env_value TELEGRAM_GROUP_CHAT_ID)
if [ -z "${QUIET:-}" ] && [ -n "$BOT_TOKEN" ] && [ -n "$OPS_CHAT" ]; then
  curl -fsS -m 30 -o /dev/null     -F "chat_id=$OPS_CHAT"     -F "text=Zaxira nusxa olindi: $stamp · $(du -h "$target" | cut -f1) · $(hostname)"     "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" || true
fi

ping_switch "$PING_URL"
