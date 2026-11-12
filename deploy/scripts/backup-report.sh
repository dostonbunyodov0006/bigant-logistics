#!/usr/bin/env bash
# One Telegram line a day about the hourly backups (owner, 07.11.2026): the
# backups run every hour, quietly; at 02:30 the office is told how many of the
# last 24 hours' runs succeeded, how many failed, and the newest dump's size.
#
# Install: see backup.sh. Cron: 30 2 * * * /usr/local/bin/bigant-backup-report
# DRY_RUN=1 prints the message instead of sending it.

set -euo pipefail

ENV_FILE=${ENV_FILE:-/opt/bigant/logistics/deploy/.env.prod}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/bigant}
LOG=${LOG:-/var/log/bigant-backup.log}

env_value() {
  grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/; s/^'\''\(.*\)'\''$/\1/'
}

since=$(date -u -d '24 hours ago' +%FT%TZ)
# Log lines start with an ISO time in UTC, so a plain string compare picks the last day.
recent() { awk -v s="$since" '$1 >= s' "$LOG" 2>/dev/null || true; }

ok=$(recent | grep -c ' ok ' || true)
failed=$(recent | grep -c ' FAIL' || true)
drive=$(recent | grep -c 'Google Drive (shifrlangan)' || true)
newest=$(ls -1t "$BACKUP_DIR"/bigant-*.sql.gz 2>/dev/null | head -1 || true)
size=$([ -n "$newest" ] && du -h "$newest" | cut -f1 || echo '—')
last=$([ -n "$newest" ] && date -d "@$(stat -c %Y "$newest")" '+%d.%m %H:%M' || echo '—')

if [ "$failed" -gt 0 ] || [ "$ok" -lt 20 ]; then
  head="⚠️ Zaxira: oxirgi 24 soatda $ok ta olindi, $failed ta xato"
else
  head="✅ Zaxira: oxirgi 24 soatda $ok ta olindi (har soatda), xato yo'q"
fi
text="$head
Google Diskka (shifrlangan): $drive ta
Oxirgisi: $last · $size · $(hostname)"

if [ -n "${DRY_RUN:-}" ]; then
  echo "$text"
  exit 0
fi

BOT_TOKEN=$(env_value TELEGRAM_BOT_TOKEN)
OPS_CHAT=$(env_value TELEGRAM_OPS_CHAT_ID)
[ -n "$OPS_CHAT" ] || OPS_CHAT=$(env_value TELEGRAM_GROUP_CHAT_ID)
if [ -n "$BOT_TOKEN" ] && [ -n "$OPS_CHAT" ]; then
  curl -fsS -m 30 -o /dev/null -F "chat_id=$OPS_CHAT" -F "text=$text" \
    "https://api.telegram.org/bot$BOT_TOKEN/sendMessage"
fi
echo "$(date -u +%FT%TZ) report sent: ok=$ok failed=$failed drive=$drive"
