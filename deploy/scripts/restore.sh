#!/usr/bin/env bash
# Bring the BIGANT database back from a backup, with one command (owner, 07.11.2026).
#
#   bigant-restore                 the newest dump on this server
#   bigant-restore drive           the newest dump in the encrypted Google Drive copy
#   bigant-restore <file.sql.gz>   that dump
#   bigant-restore new-server      a fresh server: settings, photos and the newest
#                                  dump from Google Drive, then the whole site up
#
# It asks before it overwrites anything: type HA. YES=1 skips the question.
# Only the logistics stack is touched — the other projects on this machine
# (their own containers and databases) are never stopped or read.
#
# new-server needs, before it runs: Docker, the repository at
# /opt/bigant/logistics, rclone, and /root/.config/rclone/rclone.conf — the
# `zaxira:` remote, written down in the owner's key folder (OQING-google-disk.txt).

set -euo pipefail

REPO=${REPO:-/opt/bigant/logistics}
COMPOSE_FILE=${COMPOSE_FILE:-$REPO/deploy/docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-$REPO/deploy/.env.prod}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/bigant}
RCLONE_CONF=${RCLONE_CONF:-/root/.config/rclone/rclone.conf}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

say() { echo "== $*"; }
die() { echo "XATO: $*" >&2; exit 1; }
env_value() {
  grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/; s/^'\''\(.*\)'\''$/\1/'
}
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
confirm() {
  [ -n "${YES:-}" ] && return 0
  echo "$1"
  read -r -p "Davom etish uchun HA deb yozing: " answer
  [ "$answer" = "HA" ] || die "to'xtatildi"
}
from_drive() {
  command -v rclone >/dev/null || die "rclone o'rnatilmagan"
  [ -f "$RCLONE_CONF" ] || die "$RCLONE_CONF yo'q (OQING-google-disk.txt ga qarang)"
  local newest
  newest=$(rclone --config "$RCLONE_CONF" lsf zaxira:/baza/ --files-only | grep '^bigant-.*\.sql\.gz$' | sort | tail -1)
  [ -n "$newest" ] || die "Google Diskda zaxira topilmadi"
  say "Google Diskdan: $newest"
  rclone --config "$RCLONE_CONF" copy "zaxira:/baza/$newest" "$WORK/"
  echo "$WORK/$newest"
}

mode=${1:-latest}

if [ "$mode" = "new-server" ]; then
  [ -d "$REPO" ] || die "$REPO yo'q — avval repozitoriyani shu yerga yuklang"
  confirm "Yangi server: sozlamalar, rasmlar va baza Google Diskdan olinadi, sayt ishga tushadi."
  say "1/5 sozlamalar (.env.prod, kalitlar)"
  rclone --config "$RCLONE_CONF" copyto zaxira:/sozlama/sozlama.tar.gz "$WORK/sozlama.tar.gz"
  tar -xzf "$WORK/sozlama.tar.gz" -C /
  MEDIA_DIR=$(env_value MEDIA_DIR); MEDIA_DIR=${MEDIA_DIR:-/var/lib/bigant/media}
  say "2/5 rasmlar -> $MEDIA_DIR"
  mkdir -p "$MEDIA_DIR" "$BACKUP_DIR" /var/lib/bigant/updates
  rclone --config "$RCLONE_CONF" copy zaxira:/rasm/ "$MEDIA_DIR" --transfers 8
  dump=$(from_drive | tail -1)
  say "3/5 baza ishga tushmoqda"
  compose up -d postgres
  for _ in $(seq 1 60); do compose exec -T postgres pg_isready -q </dev/null && break; sleep 2; done
else
  case "$mode" in
    latest) dump=$(ls -1t "$BACKUP_DIR"/bigant-*.sql.gz 2>/dev/null | head -1 || true)
            [ -n "$dump" ] || die "$BACKUP_DIR da zaxira yo'q — 'bigant-restore drive' ni sinang" ;;
    drive)  dump=$(from_drive | tail -1) ;;
    *)      dump=$mode; [ -f "$dump" ] || die "$dump topilmadi" ;;
  esac
  confirm "Hozirgi baza $(basename "$dump") bilan ALMASHTIRILADI ($(date -d "@$(stat -c %Y "$dump")" '+%d.%m.%Y %H:%M')). Undan keyingi o'zgarishlar yo'qoladi."
  say "Ehtiyot uchun hozirgi bazaning nusxasi olinmoqda"
  /usr/local/bin/bigant-backup >/dev/null 2>&1 && say "olindi" || say "olinmadi (baza ishlamayotgan bo'lishi mumkin) — davom etamiz"
fi

gzip -t "$dump" || die "$dump buzilgan"
POSTGRES_USER=$(env_value POSTGRES_USER)
POSTGRES_DB=$(env_value POSTGRES_DB)

say "4/5 sayt to'xtatildi, baza tiklanmoqda: $(basename "$dump")"
compose stop backend >/dev/null 2>&1 || true
# The dump was made with --clean --if-exists: it drops and recreates every table itself.
gunzip -c "$dump" | compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null
tables=$(compose exec -T postgres psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from information_schema.tables where table_schema='public'" </dev/null)
orders=$(compose exec -T postgres psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from orders" </dev/null)
say "tiklandi: $tables ta jadval, $orders ta zakaz"

say "5/5 sayt ishga tushmoqda"
compose up -d --build
# The web container reads the backend's address once; a new backend needs it to look again.
sleep 5
docker exec "$(compose ps -q web)" nginx -s reload >/dev/null 2>&1 || true
for _ in $(seq 1 60); do
  if compose exec -T backend node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" </dev/null >/dev/null 2>&1; then
    say "TAYYOR: sayt ishlayapti"
    exit 0
  fi
  sleep 5
done
die "sayt 5 daqiqada javob bermadi — 'docker compose logs backend' ni ko'ring"
