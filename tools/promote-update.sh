#!/usr/bin/env bash
# Sends the update the test phones have been running to EVERY driver.
#
#   logistics/tools/promote-update.sh              — `current` := `test` (hammaga)
#   logistics/tools/promote-update.sh --rollback   — `current` oldingisiga qaytadi
#   logistics/tools/promote-update.sh --rollback 20261109-101500
#                                                  — `current` shu nusxaga qaytadi
#   logistics/tools/promote-update.sh --list       — nima qayerda turibdi
#
# TARTIB (egasi, 09.11.2026): tools/publish-update.sh yangilanishni faqat
# sinov telefonlariga (`test`) yuboradi. Egasi sinov telefonida ishlayotganini
# ko'rgach, shu skript uni hammaga (`current`) chiqaradi. Hammaga chiqqandan
# keyin xato topilsa, --rollback oldingi nusxaga qaytaradi.
#
# One stamp directory holds every platform's manifest, so moving one symlink
# moves the Android and the iPhone update together; the script says which
# platforms the promoted stamp carries, and warns when it carries fewer than
# `current` did (an iPhone then gets 404 and keeps the code it has).
#
# Why a rollback is a fresh copy, not just the old link: expo-updates on the
# phone takes a manifest only if it is NEWER (its createdAt) than the update
# it runs. Pointing `current` back at an old stamp would be ignored by every
# phone that already took the bad one. So the old stamp is copied (hard
# links, no extra disk) under a new stamp with a new id and createdAt, and
# `current` points at the copy. The same is done on promote when `test` is
# older than `current` (a rollback happened after it was published).
#
# Nothing here builds or uploads: it only moves links on the server.
set -euo pipefail

SSH_HOST=${SSH_HOST:-bigant}
REMOTE_DIR=${REMOTE_DIR:-/var/lib/bigant/updates}
MODE=promote
TARGET=
case "${1:-}" in
  '') ;;
  --rollback) MODE=rollback; TARGET=${2:-} ;;
  --list) MODE=list ;;
  -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
  *) echo "noma'lum: $1 (--rollback [STAMP] yoki --list)"; exit 1 ;;
esac
if [ -n "$TARGET" ] && ! printf '%s' "$TARGET" | grep -Eq '^[0-9]{8}-[0-9]{6}$'; then
  echo "STAMP shunday bo'lishi kerak: 20261109-101500"; exit 1
fi

ssh "$SSH_HOST" bash -s -- "$REMOTE_DIR" "$MODE" "$TARGET" <<'REMOTE'
set -euo pipefail
cd "$1"
MODE=$2
# ssh drops an empty argument, so a plain promote arrives with no $3.
TARGET=${3:-}

link() { readlink "$1" 2>/dev/null || true; }
platforms() {
  local d=$1 out=
  [ -f "$d/manifest.multipart" ] && out="$out android"
  [ -f "$d/manifest-ios.multipart" ] && out="$out ios"
  echo "${out# }"
}
created() { grep -o '"createdAt":"[^"]*"' "$1/manifest.multipart" "$1/manifest-ios.multipart" 2>/dev/null | head -1 | sed 's/.*"createdAt":"\([^"]*\)"/\1/'; }
manifest_id() { grep -o '"id":"[^"]*"' "$1/manifest.multipart" 2>/dev/null | head -1 | sed 's/.*"id":"\([^"]*\)"/\1/'; }
swap() { ln -sfn "$2" "$1.new" && mv -Tf "$1.new" "$1"; }
show() {
  for l in current test previous; do
    t=$(link $l)
    if [ -n "$t" ]; then
      printf '%-8s -> %s  [%s]  id %s  %s\n' "$l" "$t" "$(platforms "$t")" "$(manifest_id "$t")" "$(created "$t")"
    else
      printf '%-8s -> (yo'"'"'q)\n' "$l"
    fi
  done
}

# A copy of stamp $1 under a new stamp, with a new id and createdAt in every
# manifest, so phones running something newer still take it. Hard links share
# the bundle files; `sed -i` writes the manifest as a new file, so the original
# stamp is not touched. The first "id" / "createdAt" on the line is the
# manifest's own (build-update-manifest.mjs writes them first).
restamp() {
  local src=$1 new now uuid f
  new=$(date -u +%Y%m%d-%H%M%S)
  while [ -e "$new" ]; do sleep 1; new=$(date -u +%Y%m%d-%H%M%S); done
  now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  cp -al "$src" "$new"
  for f in "$new"/manifest.multipart "$new"/manifest-ios.multipart; do
    [ -f "$f" ] || continue
    uuid=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || true)
    [ -n "$uuid" ] || { echo "uuid yaratib bo'lmadi" >&2; exit 1; }
    sed -i -e "s/\"id\":\"[^\"]*\"/\"id\":\"$uuid\"/" -e "s/\"createdAt\":\"[^\"]*\"/\"createdAt\":\"$now\"/" "$f"
  done
  echo "$new"
}

prune() {
  local keep d
  keep=" $(link current) $(link test) $(link previous) "
  ls -1 . | grep -E '^[0-9]{8}-[0-9]{6}$' | sort | head -n -5 | while read -r d; do
    case "$keep" in *" $d "*) ;; *) rm -rf -- "$d" ;; esac
  done || true
}

warn_platforms() {
  local old=$1 new=$2 p
  [ -n "$old" ] || return 0
  for p in $(platforms "$old"); do
    case " $(platforms "$new") " in *" $p "*) ;; *) echo "DIQQAT: yangi nusxada $p yo'q — $p telefonlar 404 oladi va o'zidagisida qoladi." ;; esac
  done
}

case "$MODE" in
  list)
    show
    echo "-- nusxalar:"
    ls -1 . | grep -E '^[0-9]{8}-[0-9]{6}$' | sort | while read -r d; do echo "   $d  [$(platforms "$d")]"; done
    ;;

  promote)
    T=$(link test); C=$(link current)
    [ -n "$T" ] && [ -d "$T" ] || { echo "test yo'q: avval tools/publish-update.sh"; exit 1; }
    if [ "$T" = "$C" ]; then echo "Hech narsa: test allaqachon hammada ($T)."; show; exit 0; fi
    SRC=$T
    # A rollback after this was published left `current` newer: phones would ignore it.
    if [ -n "$C" ] && [ -d "$C" ] && [[ "$(created "$T")" < "$(created "$C")" ]]; then
      SRC=$(restamp "$T")
      echo "test current'dan eski edi: $T nusxasi $SRC sifatida yangi sana bilan chiqarildi."
      swap test "$SRC"
    fi
    warn_platforms "$C" "$SRC"
    [ -n "$C" ] && swap previous "$C"
    swap current "$SRC"
    prune
    echo "== HAMMAGA chiqdi: current -> $SRC (oldin: ${C:-hech})"
    show
    ;;

  rollback)
    C=$(link current)
    [ -n "$C" ] || { echo "current yo'q: qaytaradigan narsa yo'q"; exit 1; }
    if [ -n "$TARGET" ]; then
      BACK=$TARGET
    else
      BACK=$(link previous)
      [ -n "$BACK" ] || { echo "previous yo'q. --list bilan nusxani tanlang: --rollback STAMP"; exit 1; }
    fi
    [ -d "$BACK" ] || { echo "$BACK nusxasi serverda yo'q (--list)"; exit 1; }
    [ "$BACK" != "$C" ] || { echo "$BACK allaqachon current"; exit 1; }
    NEW=$(restamp "$BACK")
    warn_platforms "$C" "$NEW"
    swap current "$NEW"
    # Test phones on the bad update go back too; a newer test publish is left alone.
    [ "$(link test)" = "$C" ] && swap test "$NEW"
    # The bad one is not a rollback target; the next --rollback needs a STAMP.
    rm -f previous
    prune
    echo "== ORQAGA QAYTDI: current -> $NEW ($BACK nusxasi; yomoni: $C)"
    show
    ;;
esac
REMOTE
