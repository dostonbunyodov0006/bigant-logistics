/**
 * On-the-fly Cloudinary watermark.
 *
 * Inserts the BIGANT overlay (bottom-left, ~28% of the photo's width, 65% opacity)
 * into a delivered image URL WITHOUT touching the stored original — the un-watermarked
 * proof is preserved for disputes, and the watermark exists only in what we hand out.
 *
 * The overlay public_id comes from CLOUDINARY_WATERMARK_ID; per Cloudinary's layer
 * syntax, folder slashes become colons and spaces are percent-encoded (e.g.
 * `My Brand/logo` → `My%20Brand:logo`). Double-encoding a space (`%2520`) makes
 * Cloudinary return HTTP 400, so we encode exactly once.
 *
 * Returns the URL unchanged when watermarking isn't configured or the URL isn't a
 * Cloudinary `/image/upload/` URL (e.g. the `placehold.co` fallback).
 */
const WATERMARK_TRANSFORM = 'fl_relative,w_0.28,o_65,g_south_west,x_0.03,y_0.05,fl_layer_apply';
const UPLOAD_MARKER = '/image/upload/';

export function applyWatermark(url: string | null | undefined): string | null {
  if (!url) {
    return url ?? null;
  }
  const id = process.env.CLOUDINARY_WATERMARK_ID;
  if (!id) {
    return url;
  }
  const at = url.indexOf(UPLOAD_MARKER);
  if (at === -1) {
    return url;
  }
  const overlayId = id.replace(/\//g, ':').replace(/ /g, '%20');
  const insertAt = at + UPLOAD_MARKER.length;
  return `${url.slice(0, insertAt)}l_${overlayId},${WATERMARK_TRANSFORM}/${url.slice(insertAt)}`;
}
