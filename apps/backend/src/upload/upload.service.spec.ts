import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { UploadService } from './upload.service';

describe('UploadService.uploadBase64 — what a browser sends (07.11.2026)', () => {
  let dir: string;
  let svc: UploadService;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bigant-upload-'));
    const values: Record<string, unknown> = { MEDIA_DIR: dir, MEDIA_PUBLIC_URL: 'https://x.test/media', PORT: 3000 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new UploadService({ get: (k: string) => values[k] } as any);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const jpeg = () =>
    sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 80, b: 20 } } }).jpeg().toBuffer();

  it('takes a FileReader data URL (the ombor page) and stores a real JPEG', async () => {
    const dataUrl = `data:image/jpeg;base64,${(await jpeg()).toString('base64')}`;
    const url = await svc.uploadBase64(dataUrl, 'ombor');
    expect(url).toMatch(/^https:\/\/x\.test\/media\/ombor\/.+\.jpg$/);
    const saved = await readFile(join(dir, url.replace('https://x.test/media/', '')));
    expect((await sharp(saved).metadata()).format).toBe('jpeg');
  });

  it('still takes bare base64 (the driver app)', async () => {
    const url = await svc.uploadBase64((await jpeg()).toString('base64'), 'ombor');
    expect(url).toMatch(/\.jpg$/);
  });

  it('still refuses what is not an image', async () => {
    await expect(svc.uploadBase64(Buffer.from('not a photo at all, just text'.repeat(10)).toString('base64'))).rejects.toThrow('invalid_image');
  });
});
