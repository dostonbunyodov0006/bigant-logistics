/**
 * A photo from the admin's disk, made small enough to send.
 *
 * A scan of a passport off a phone is 3–6 MB; the API caps a photo body at
 * ~7 MB of base64 and shrinks it to 1600px on arrival anyway, so the browser
 * makes the first cut here and the upload stops failing on size alone. The
 * result is the raw base64 the upload endpoint takes, without the data: head.
 */
export async function fileToJpegBase64(file: File, maxSide = 2000): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
