/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * The API base is the one setting that differs between a laptop and a shipped
 * APK, so it does not belong in the static app.json — hardcoding production
 * there silently pointed `expo start` at the live server, where CORS refuses
 * browser requests and the driver saw an empty profile and no orders.
 *
 * Default is production, because a release APK that quietly talked to
 * `localhost` would be broken on every phone and hard to spot. Development
 * overrides it through `.env.development`, which Expo loads only when
 * NODE_ENV is not production (i.e. `expo start` and debug builds).
 *
 * `localhost` on a phone means the phone, so src/lib/api.ts swaps that host for
 * the machine serving the bundle — a handset on the LAN needs no extra setup.
 * Override it anyway with `.env.local` (git-ignored) to point at another box.
 */
const PRODUCTION_API = 'https://logistics.example.com/api';

const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest } = require('expo/config-plugins');

/** A plain-http API (a LAN demo build against a laptop) needs cleartext
 *  traffic, which Android blocks by default since API 28. */
const withCleartext = (cfg) =>
  withAndroidManifest(cfg, (c) => {
    c.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return c;
  });

module.exports = ({ config }) => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || PRODUCTION_API;
  // google-services.json is kept off the repo; without it the build still
  // works, push notifications just stay off.
  const android = { ...config.android };
  const pushEnabled = fs.existsSync(path.join(__dirname, 'google-services.json'));
  if (!pushEnabled) delete android.googleServicesFile;
  // iPhone build only: the push entitlement comes from the notifications
  // plugin. The Android build is left exactly as it was.
  const plugins =
    process.env.EAS_BUILD_PLATFORM === 'ios' ? [...(config.plugins ?? []), 'expo-notifications'] : config.plugins;
  const result = {
    ...config,
    android,
    plugins,
    extra: { ...config.extra, apiUrl, pushEnabled },
  };
  return apiUrl.startsWith('http://') ? withCleartext(result) : result;
};
