/**
 * Writes the manifest expo-updates asks for, from what `expo export` produced.
 *
 * The client sends `expo-platform` and `expo-runtime-version` and expects a
 * multipart/mixed document with a `manifest` part (Expo Updates protocol v1).
 * nginx serves this file as-is, so the boundary here and the one in
 * default.conf.template must stay the same word.
 *
 * Every asset is named by its own hash already, so the url is the file and the
 * hash we hand over is read back from the bytes — a half-copied file fails the
 * check on the phone instead of booting a broken app.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dist, runtimeVersion, platform = 'android'] = process.argv.slice(2);
if (!dist || !runtimeVersion || !['android', 'ios'].includes(platform)) {
  console.error('usage: build-update-manifest.mjs <dist-dir> <runtime-version> [android|ios]');
  process.exit(1);
}

const BOUNDARY = 'bigant-update';
/** base64url of the file's sha256 — what the client compares against. */
const hashOf = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('base64url');

const metadata = JSON.parse(readFileSync(join(dist, 'metadata.json'), 'utf8'));
// One manifest per platform (06.11.2026): an iPhone given the Android bundle would not start.
const files = metadata.fileMetadata?.[platform];
if (!files) throw new Error(`metadata.json has no ${platform} bundle — was --platform ${platform} (or all) passed?`);

const asset = (path, ext) => ({
  // The key is what the client stores the file under: its hash, so the same
  // bytes are never downloaded twice across updates.
  key: hashOf(join(dist, path)),
  contentType: contentTypeOf(ext ?? path.split('.').pop() ?? ''),
  fileExtension: `.${ext ?? path.split('.').pop()}`,
  url: `https://logistics.example.com/updates/${path.replaceAll('\\', '/')}`,
  hash: hashOf(join(dist, path)),
});

function contentTypeOf(ext) {
  const map = {
    js: 'application/javascript',
    hbc: 'application/javascript',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ttf: 'font/ttf',
    otf: 'font/otf',
    json: 'application/json',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

// What Constants.expoConfig reads on the phone while it runs this update:
// apiUrl, pushEnabled, version. Left empty, push registration was skipped.
const expoClient = JSON.parse(readFileSync(join(dist, 'app-config.json'), 'utf8'));
// Android push needs google-services.json; the iPhone registers with Apple instead.
if (platform === 'android' && !expoClient.extra?.pushEnabled) throw new Error('app-config.json: pushEnabled is not true — google-services.json missing?');

const manifest = {
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  runtimeVersion,
  launchAsset: { ...asset(files.bundle, 'hbc'), contentType: 'application/javascript' },
  assets: (files.assets ?? []).map((a) => asset(a.path, a.ext)),
  metadata: {},
  extra: { expoClient },
};

const body =
  `--${BOUNDARY}\r\n` +
  'Content-Disposition: form-data; name="manifest"\r\n' +
  'Content-Type: application/json; charset=utf-8\r\n\r\n' +
  `${JSON.stringify(manifest)}\r\n` +
  `--${BOUNDARY}--\r\n`;

// nginx hands manifest-ios.multipart to a phone that says `expo-platform: ios`.
writeFileSync(join(dist, platform === 'ios' ? 'manifest-ios.multipart' : 'manifest.multipart'), body);
console.log(
  `manifest (${platform}): ${manifest.assets.length + 1} fayl, runtime ${runtimeVersion}, id ${manifest.id}`,
);
