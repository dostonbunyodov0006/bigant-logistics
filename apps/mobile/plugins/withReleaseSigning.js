/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Signs release builds with a real keystore instead of the debug key.
 *
 * `expo prebuild` regenerates android/ from scratch and that directory is
 * gitignored, so editing app/build.gradle by hand is undone by the next build.
 * A config plugin re-applies the change every time, which is why this exists
 * rather than a one-off edit.
 *
 * Credentials are read from Gradle properties, never from this repo. Put them
 * in ~/.gradle/gradle.properties (outside the project, so they cannot be
 * committed):
 *
 *   BIGANT_STORE_FILE=/home/you/bigant-release.jks
 *   BIGANT_STORE_PASSWORD=...
 *   BIGANT_KEY_ALIAS=bigant
 *   BIGANT_KEY_PASSWORD=...
 *
 * With the properties absent the build still works and falls back to the debug
 * key, but says so loudly — a release APK that is silently debug-signed is the
 * failure worth catching, because you only discover it months later when an
 * update will not install.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING_CONFIG = `
        release {
            if (project.hasProperty('BIGANT_STORE_FILE')) {
                storeFile file(project.property('BIGANT_STORE_FILE'))
                storePassword project.property('BIGANT_STORE_PASSWORD')
                keyAlias project.property('BIGANT_KEY_ALIAS')
                keyPassword project.property('BIGANT_KEY_PASSWORD')
            } else {
                println("[BIGANT] WARNING: BIGANT_STORE_FILE not set - release APK will be DEBUG-SIGNED. " +
                        "Such a build cannot update an app installed with the real key.")
            }
        }`;

/** Replace the first `signingConfig signingConfigs.debug` inside buildTypes.release. */
function useReleaseKeyInReleaseBuildType(contents) {
  const marker = 'buildTypes {';
  const at = contents.indexOf(marker);
  if (at === -1) throw new Error('[withReleaseSigning] no buildTypes block in app/build.gradle');

  const head = contents.slice(0, at);
  const tail = contents.slice(at);

  // Only touch the release buildType — the debug one legitimately uses the debug key.
  const releaseAt = tail.indexOf('release {');
  if (releaseAt === -1) throw new Error('[withReleaseSigning] no release buildType found');

  const before = tail.slice(0, releaseAt);
  const after = tail.slice(releaseAt);
  const target = 'signingConfig signingConfigs.debug';
  if (!after.includes(target)) {
    // Already pointed somewhere else (re-run, or Expo changed its template).
    return contents;
  }
  return (
    head +
    before +
    after.replace(
      target,
      "signingConfig project.hasProperty('BIGANT_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    )
  );
}

/** Pure transform, exported so it can be exercised without running a full build. */
function applyToBuildGradle(input) {
  let contents = input;

  if (!contents.includes('BIGANT_STORE_FILE')) {
    if (!/signingConfigs\s*\{/.test(contents)) {
      throw new Error('[withReleaseSigning] no signingConfigs block in app/build.gradle');
    }
    const debugEnd = contents.indexOf("keyPassword 'android'");
    if (debugEnd === -1) {
      throw new Error('[withReleaseSigning] could not locate the debug signingConfig');
    }
    const closeBrace = contents.indexOf('}', debugEnd);
    contents = contents.slice(0, closeBrace + 1) + SIGNING_CONFIG + contents.slice(closeBrace + 1);
  }

  return useReleaseKeyInReleaseBuildType(contents);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyToBuildGradle(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.applyToBuildGradle = applyToBuildGradle;
