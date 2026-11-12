import { applyWatermark } from './watermark';

describe('applyWatermark', () => {
  const CLOUD = 'https://res.cloudinary.com/ddyudhwnr/image/upload';
  const original = process.env.CLOUDINARY_WATERMARK_ID;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLOUDINARY_WATERMARK_ID;
    } else {
      process.env.CLOUDINARY_WATERMARK_ID = original;
    }
  });

  it('passes null/undefined through as null', () => {
    process.env.CLOUDINARY_WATERMARK_ID = 'My Brand/logo';
    expect(applyWatermark(null)).toBeNull();
    expect(applyWatermark(undefined)).toBeNull();
  });

  it('returns the url unchanged when watermarking is not configured', () => {
    delete process.env.CLOUDINARY_WATERMARK_ID;
    const url = `${CLOUD}/v1/delivery-proofs/abc.jpg`;
    expect(applyWatermark(url)).toBe(url);
  });

  it('returns non-Cloudinary urls unchanged (e.g. the placeholder fallback)', () => {
    process.env.CLOUDINARY_WATERMARK_ID = 'My Brand/logo';
    const url = 'https://placehold.co/600x400?text=No+Photo';
    expect(applyWatermark(url)).toBe(url);
  });

  it('inserts the overlay after /image/upload/, colon-joining folders and encoding spaces', () => {
    process.env.CLOUDINARY_WATERMARK_ID = 'My Brand/logo';
    const out = applyWatermark(`${CLOUD}/v1/delivery-proofs/abc.jpg`);
    expect(out).toBe(
      `${CLOUD}/l_My%20Brand:logo,fl_relative,w_0.28,o_65,g_south_west,x_0.03,y_0.05,fl_layer_apply/v1/delivery-proofs/abc.jpg`,
    );
    // never double-encodes the space (that would 400 at Cloudinary)
    expect(out).not.toContain('%2520');
  });
});
