import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import sharp from 'sharp';
import type { Env } from '../config/env.validation';

/** Per-attempt upload timeout (ms). Generous, for slow/VPN connections. */
const UPLOAD_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 2;

/** Phones send full-resolution camera shots (1–3 MB). Proof photos are read on
 *  a screen and in Telegram, so 1600px on the long side at q75 keeps them sharp
 *  at roughly a tenth of the size — the difference between ~30 GB and ~300 GB a
 *  year of storage. Cloudinary used to do this for us (1280px). */
const MAX_SIDE_PX = 1600;
const JPEG_QUALITY = 75;

interface S3Target {
  client: S3Client;
  bucket: string;
  publicUrl: string;
}

/**
 * Stores proof photos. Backends, in order of preference:
 *   1. S3-compatible object storage — when S3_ENDPOINT, S3_PUBLIC_URL and the
 *      access keys are set;
 *   2. Cloudinary — when its three credentials are set;
 *   3. this server's disk (MEDIA_DIR) — the default.
 */
@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);
  private readonly s3: S3Target | null;
  private readonly cloudinaryConfigured: boolean;
  /** Absolute directory photos are written to when stored on disk. */
  readonly mediaDir: string;
  private readonly mediaPublicUrl: string;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    const publicUrl = config.get('S3_PUBLIC_URL', { infer: true });
    const accessKeyId = config.get('S3_ACCESS_KEY', { infer: true });
    const secretAccessKey = config.get('S3_SECRET_KEY', { infer: true });
    this.s3 =
      endpoint && publicUrl && accessKeyId && secretAccessKey
        ? {
            client: new S3Client({
              endpoint,
              region: config.get('S3_REGION', { infer: true }),
              credentials: { accessKeyId, secretAccessKey },
              // Self-hosted stores serve buckets as paths (host/bucket/key).
              forcePathStyle: true,
            }),
            bucket: config.get('S3_BUCKET', { infer: true }),
            publicUrl: stripSlash(publicUrl),
          }
        : null;

    const name = config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const key = config.get('CLOUDINARY_API_KEY', { infer: true });
    const secret = config.get('CLOUDINARY_API_SECRET', { infer: true });
    this.cloudinaryConfigured = !this.s3 && !!(name && key && secret);
    if (this.cloudinaryConfigured) {
      cloudinary.config({
        cloud_name: name,
        api_key: key,
        api_secret: secret,
        timeout: UPLOAD_TIMEOUT_MS,
      });
    }

    this.mediaDir = resolve(config.get('MEDIA_DIR', { infer: true }));
    this.mediaPublicUrl = stripSlash(
      config.get('MEDIA_PUBLIC_URL', { infer: true }) ??
        `http://localhost:${config.get('PORT', { infer: true })}/media`,
    );
  }

  async onModuleInit(): Promise<void> {
    if (this.s3) {
      this.logger.log(`Photo storage: S3 bucket "${this.s3.bucket}" (${this.s3.publicUrl})`);
    } else if (this.cloudinaryConfigured) {
      this.logger.log('Photo storage: Cloudinary');
    } else {
      await mkdir(this.mediaDir, { recursive: true });
      this.logger.log(`Photo storage: disk ${this.mediaDir} (${this.mediaPublicUrl})`);
    }
  }

  async uploadBase64(base64Data: string, folder = 'delivery-proofs'): Promise<string> {
    // A browser's FileReader hands over "data:image/jpeg;base64,…" (the ombor page
    // does): the prefix decoded as photo bytes and every warehouse photo was
    // refused as not an image (07.11.2026). The bare base64 is what is kept.
    base64Data = base64Data.replace(/^data:[^,]*,/, '');
    if (this.cloudinaryConfigured) {
      // Cloudinary resizes on its side.
      return this.uploadToCloudinary(base64Data, folder);
    }
    const photo = await shrink(base64Data);
    const key = `${folder}/${randomUUID()}.jpg`;
    return this.s3 ? this.uploadToS3(this.s3, key, photo) : this.saveToDisk(key, photo);
  }

  private async saveToDisk(key: string, photo: Buffer): Promise<string> {
    const path = join(this.mediaDir, key);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, photo);
    } catch (err) {
      this.logger.error(`Saving photo to ${path} failed: ${describeError(err)}`);
      throw new ServiceUnavailableException('photo_upload_failed');
    }
    return `${this.mediaPublicUrl}/${key}`;
  }

  private async uploadToS3(s3: S3Target, key: string, photo: Buffer): Promise<string> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await s3.client.send(
          new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: photo, ContentType: 'image/jpeg' }),
          { abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) },
        );
        return `${s3.publicUrl}/${key}`;
      } catch (err) {
        this.logger.error(`S3 upload attempt ${attempt}/${MAX_ATTEMPTS} failed: ${describeError(err)}`);
      }
    }
    throw new ServiceUnavailableException('photo_upload_failed');
  }

  private async uploadToCloudinary(base64Data: string, folder: string): Promise<string> {
    const dataUri = `data:image/jpeg;base64,${base64Data}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result: UploadApiResponse = await cloudinary.uploader.upload(dataUri, {
          folder,
          resource_type: 'image',
          timeout: UPLOAD_TIMEOUT_MS,
          // Cap stored size so the proof stays small (and Telegram fetches it fast).
          transformation: [{ width: 1280, height: 1280, crop: 'limit', quality: 'auto' }],
        });
        return result.secure_url;
      } catch (err) {
        const last = attempt === MAX_ATTEMPTS;
        this.logger.error(
          `Cloudinary upload attempt ${attempt}/${MAX_ATTEMPTS} failed: ${describeError(err)}`,
        );
        if (last) {
          // Clean, translatable error instead of leaking the raw Cloudinary 500.
          throw new ServiceUnavailableException('photo_upload_failed');
        }
      }
    }
    /* istanbul ignore next — loop always returns or throws above */
    throw new ServiceUnavailableException('photo_upload_failed');
  }
}

/** Decodes the phone's photo, applies its EXIF rotation, caps the long side and
 *  re-encodes as JPEG. Anything that is not a decodable image is refused. */
async function shrink(base64Data: string, maxSide = MAX_SIDE_PX): Promise<Buffer> {
  try {
    // A small file can unpack to gigabytes (a 16k×16k PNG): 40 megapixels is
    // over any phone camera and keeps one photo from taking the server down.
    return await sharp(Buffer.from(base64Data, 'base64'), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new BadRequestException('invalid_image');
  }
}

/**
 * The same photo, small enough to read by machine: a dispenser display is
 * legible at 1600px, and the phone's full-size frame — several megabytes —
 * was being pushed to the reader whole, which is where the wait came from.
 */
export async function shrinkForReading(base64Data: string): Promise<string> {
  try {
    return (await shrink(base64Data, 1600)).toString('base64');
  } catch {
    // Not a frame sharp can decode: the reader gets what the phone sent, and
    // the upload step says whether it is an image at all.
    return base64Data;
  }
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Cloudinary rejects with a plain `{ message, http_code, name }` object, not an Error. */
function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
