import { z } from 'zod';

/** Validates and types process.env at boot. Fail fast on misconfiguration. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_TTL: z.string().default('900s'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  CORS_ORIGINS: z.string().optional(),
  // Private Photon instance used by authenticated geocoding endpoints.
  PHOTON_URL: z.string().url().default('http://127.0.0.1:2322'),
  PHOTON_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(5_000),
  // Private Valhalla instance used by authenticated routing endpoints.
  VALHALLA_URL: z.string().url().default('http://127.0.0.1:8002'),
  VALHALLA_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  SCHEDULE_CONFLICT_WINDOW_MINUTES: z.coerce.number().int().positive().default(90),
  // Telegram proof reports — optional; when unset, sends are logged instead of delivered.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_GROUP_CHAT_ID: z.string().optional(),
  // Separate group for Vozrat (return) hand-back photos. Send stays inert until set.
  TELEGRAM_VOZRAT_GROUP_ID: z.string().optional(),
  // Separate group for pickup (loading) photos. Send stays inert until set.
  TELEGRAM_PICKUP_GROUP_ID: z.string().optional(),
  // Fuel fill-ups (dispenser photo) and service visits (work photos + receipt).
  TELEGRAM_FUEL_GROUP_ID: z.string().optional(),
  TELEGRAM_SERVICE_GROUP_ID: z.string().optional(),
  // The office's own alerts (the driver app gone quiet on shift, app-health/).
  // Empty = the main group, TELEGRAM_GROUP_CHAT_ID.
  TELEGRAM_OPS_CHAT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Photo storage on this server's disk — the default. Files land in MEDIA_DIR
  // and their URLs are MEDIA_PUBLIC_URL/<folder>/<uuid>.jpg (in production
  // nginx serves that directory at https://<domain>/media). Defaults to the API
  // serving it itself at http://localhost:<PORT>/media for development.
  MEDIA_DIR: z.string().default('./media'),
  MEDIA_PUBLIC_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  // Optional: any S3-compatible object store (Garage, SeaweedFS, AWS S3,
  // Cloudflare R2 …) instead of the disk, for when photos outgrow one server.
  // S3_ENDPOINT is how the API reaches it; S3_PUBLIC_URL is the public base of
  // the stored photo URLs (what phones, the dashboard and Telegram fetch).
  S3_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  S3_PUBLIC_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  S3_BUCKET: z.string().default('bigant'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  // Cloudinary — optional; when unset, upload returns a placeholder URL.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  // public_id of the watermark overlay asset (folders allowed, e.g. "My Brand/logo").
  CLOUDINARY_WATERMARK_ID: z.string().optional(),

  // Reading the dispenser off the photo. Optional on purpose: with no key the
  // driver types the numbers, exactly as before the AI existed.
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  // The stalled-lorry watch cancels orders whose lorry does not move. Off until
  // drivers' phones report position in the background — with the app closed a
  // moving lorry looks still, and every booking would be cancelled.
  IDLE_WATCH_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // The Google Maps key for the browser (restricted to our domain in Google
  // Cloud). Empty = the map is drawn on our own tiles, as before.
  GOOGLE_MAPS_BROWSER_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // ESRI World Imagery key (ArcGIS Location Platform, free tier, referrer-restricted):
  // the satellite picture under our own map (owner, 03.11.2026). Empty = no Sputnik button.
  ESRI_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  GEMINI_VISION_MODEL: z.string().default('gemini-3.5-flash-lite'),
  OPENAI_VISION_MODEL: z.string().default('gpt-4.1-mini'),
  FUEL_AI_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(15_000),
  // 'off' while the fleet is being tested from the office: a fill-up is then
  // never flagged for being away from the station's pin.
  FUEL_FENCE_CHECK: z.enum(['on', 'off']).default('on'),
  // Firebase Cloud Messaging — optional; when unset, push is logged instead of delivered.
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  // iPhone push through Apple's APNs (owner, 06.11.2026): the .p8 key (its
  // text or a path), its id and the Apple team id, from the Apple Developer
  // account. Unset = iPhone push off; Android is not affected.
  APNS_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  APNS_KEY_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  APNS_TEAM_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  APNS_BUNDLE_ID: z.string().default('com.bigant.driver'),
  // TestFlight and App Store builds use production APNs; a development build the sandbox.
  APNS_PRODUCTION: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  // Omborchi (owner, 05.11.2026): the mini app's bot (@bigant_innovation_bot)
  // — it signs the storekeepers in on the warehouse page and tells them about
  // returns. Without it the page refuses sign-in and no message goes out.
  VOZVRAT_BOT_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // This site's host name, for the button that opens the warehouse page.
  PUBLIC_DOMAIN: z.string().default('logistics.example.com'),
  // Driver app updates go to these accounts first (owner, 09.11.2026): user ids,
  // comma-separated. Empty = no test phones; a published update then waits in
  // `test` until tools/promote-update.sh sends it to everyone.
  OTA_TESTER_USER_IDS: z.string().default(''),
  // How long a driver's position trail (route history) is kept.
  TRACK_RETENTION_DAYS: z.coerce.number().int().positive().default(31),
  // Background outbox dispatcher.
  WORKER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  // Assignment timeout: auto-reject unanswered assignments after N minutes.
  ASSIGNMENT_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(10),
  ASSIGNMENT_TIMEOUT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  // Document expiry reminders: how often to scan docs and notify staff (default 6h).
  DOCUMENT_EXPIRY_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(21_600_000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = JSON.stringify(parsed.error.flatten().fieldErrors);
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  // The live server refuses weak or shared signing keys (06.11.2026): with
  // one key for both, a 30-day refresh token would pass as an access token.
  const e = parsed.data;
  if (e.NODE_ENV === 'production') {
    const weak = (s: string) => s.length < 32 || /change_?me/i.test(s);
    if (weak(e.JWT_ACCESS_SECRET) || weak(e.JWT_REFRESH_SECRET)) {
      throw new Error('Invalid environment configuration: JWT secrets must be 32+ characters and not the example value');
    }
    if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
      throw new Error('Invalid environment configuration: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
    }
  }
  return e;
}
