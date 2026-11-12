#!/usr/bin/env bash
# Sends the driver app's JavaScript to the TEST phones, without an APK.
#
#   logistics/tools/publish-update.sh
#
# ---------------------------------------------------------------------------
# TARTIB (egasi, 09.11.2026): yangilanish avval faqat sinov telefonlariga
# boradi. Bir marta yomon yangilanish hamma telefonni birdan buzgan edi.
#
#   1. tools/publish-update.sh   — yangilanish serverga, `test` ga tushadi.
#                                  Faqat sinov telefonlari oladi (serverdagi
#                                  .env: OTA_TESTER_USER_IDS — ularning
#                                  users.id lari, vergul bilan).
#   2. Sinov telefonida ilovani yopib, qayta oching (ba'zan ikki marta: birinchi
#      ochilishda telefon o'zi sinovchi ekanini bilib oladi).
#   3. Egasi tekshiradi: ishlayaptimi?
#   4. Ishlasa:   tools/promote-update.sh            — hamma haydovchiga.
#      Ishlamasa: hech narsa qilmang — haydovchilar eskisida qoladi;
#                 tuzating va 1-qadamdan qayta.
#   Hammaga chiqib, keyin xato topilsa:
#                 tools/promote-update.sh --rollback — oldingisiga qaytaradi.
#   Holatni ko'rish: tools/promote-update.sh --list
# ---------------------------------------------------------------------------
#
# What happens: the app is exported, a manifest is written in the shape
# expo-updates asks for, both are copied to the server into a new stamp
# directory, and `test` is pointed at it. `current` — what every driver gets —
# is left alone; nginx gives `test` only to phones whose updater sends
# `tester="1"` (the app sets it when the server lists the account), and
# tools/promote-update.sh moves `current` once the owner has seen it work.
#
# What this CANNOT ship: a new native module or an Android permission. Those
# live in the APK, and `runtimeVersion` in app.json is what keeps them apart —
# bump it when the native side changes, and old phones stop taking updates
# meant for a newer shell (rather than crashing on them).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
MOBILE="$HERE/../apps/mobile"
SSH_HOST=${SSH_HOST:-bigant}
REMOTE_DIR=${REMOTE_DIR:-/var/lib/bigant/updates}
STAMP=$(date -u +%Y%m%d-%H%M%S)
# Which phones get this update: android (default), or "android ios" once the
# iPhone build is out (06.11.2026). Each platform gets its own manifest.
PLATFORMS=${PLATFORMS:-android}
case " $PLATFORMS " in *" ios "*) EXPORT_PLATFORM=all ;; *) EXPORT_PLATFORM=android ;; esac

cd "$MOBILE"
RUNTIME=$(node -e "process.stdout.write(String(require('./app.json').expo.runtimeVersion))")
echo "== eksport (runtime $RUNTIME)"
rm -rf dist
# NODE_ENV=production so the bundle points at the live API, exactly as a
# release APK does.
NODE_ENV=production EXPO_NO_TELEMETRY=1 npx expo export --platform "$EXPORT_PLATFORM" --output-dir dist >/tmp/expo-export.log 2>&1 || {
  echo "eksport xato:"; tail -20 /tmp/expo-export.log; exit 1;
}

# The app's own config (app.config.js resolved: apiUrl, pushEnabled, version)
# rides in the manifest. Without it a phone running an update has no
# Constants.expoConfig, and it silently stopped registering for push.
NODE_ENV=production EXPO_NO_TELEMETRY=1 npx expo config --type public --json >dist/app-config.json 2>/tmp/expo-config.log || {
  echo "config xato:"; tail -20 /tmp/expo-config.log; exit 1;
}

echo "== manifest"
for P in $PLATFORMS; do node "$HERE/build-update-manifest.mjs" "$MOBILE/dist" "$RUNTIME" "$P"; done

echo "== serverga yuborish ($STAMP)"
ssh "$SSH_HOST" "mkdir -p $REMOTE_DIR/$STAMP"
scp -q -r "$MOBILE/dist/." "$SSH_HOST:$REMOTE_DIR/$STAMP/"
# The symlink is swapped in one step, so a phone asking mid-upload gets either
# the old update whole or the new one whole, never half of each.
# A relative link, because nginx reads it from inside the container where
# this directory is mounted somewhere else entirely — an absolute one points
# at a path that does not exist there.
# Only `test` moves (owner, 09.11.2026); `current` waits for promote-update.sh.
# The last five stamps are kept, and never one that `current`, `test` or
# `previous` (the rollback target) points at.
ssh "$SSH_HOST" bash -s -- "$REMOTE_DIR" "$STAMP" <<'REMOTE'
set -euo pipefail
cd "$1"
ln -sfn "$2" test.new && mv -Tf test.new test
keep=" $(readlink current 2>/dev/null || true) $(readlink test 2>/dev/null || true) $(readlink previous 2>/dev/null || true) "
ls -1 . | grep -E '^[0-9]{8}-[0-9]{6}$' | sort | head -n -5 | while read -r d; do
  case "$keep" in *" $d "*) ;; *) rm -rf -- "$d" ;; esac
done || true
echo "test    -> $(readlink test)"
echo "current -> $(readlink current 2>/dev/null || echo "(yo'q)")"
REMOTE

echo "== tekshirish (sinov telefoni bo'lib so'raymiz)"
for P in $PLATFORMS; do
  echo "-- $P"
  curl -fsS -m 20 -D - -o /dev/null     -H "expo-platform: $P" -H 'expo-protocol-version: 1' -H "expo-runtime-version: $RUNTIME"     -H 'expo-extra-params: tester="1"'     https://logistics.example.com/updates/manifest | head -3
done
echo "== tayyor: faqat SINOV telefonlari oladi (ilovani qayta ochganda)."
echo "   Ishlasa, hammaga: tools/promote-update.sh"
