/**
 * Getting a picture out of the browser and into a chat.
 *
 * The seller is asked for a lorry's papers over Telegram. Two doors out, each
 * reporting whether it opened: put the image on the clipboard (desktop
 * Telegram takes Ctrl+V), or hand it to the phone's share sheet, which lists
 * Telegram. Neither needs the bot, so they work for a seller whose Telegram
 * the office has not linked.
 */
async function fetchImage(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image ${res.status}`);
  return res.blob();
}

/** PNG is the one image type every browser's clipboard accepts. */
async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'),
  );
}

export function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
}

export function canShareFiles(): boolean {
  // Phones only: Windows offers a share sheet too, but its Telegram entries
  // (Unigram) take no files, and the seller is left with nothing (owner,
  // 03.11.2026). On a computer the way out is Nusxa + Ctrl+V.
  const phone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return phone && !!navigator.share && !!navigator.canShare;
}

/**
 * Both sides of a paper as one picture, front above back (owner, 03.11.2026:
 * one Nusxa, one Ulashish per document). The clipboard takes a single image,
 * so the two are stacked on one canvas with a white gap between them.
 */
async function stackPng(urls: string[]): Promise<Blob> {
  const bitmaps = await Promise.all(urls.map((u) => fetchImage(u).then((b) => createImageBitmap(b))));
  const gap = 24;
  const width = Math.max(...bitmaps.map((b) => b.width));
  const height = bitmaps.reduce((h, b) => h + Math.round((b.height * width) / b.width), 0) + gap * (bitmaps.length - 1);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const b of bitmaps) {
    const h = Math.round((b.height * width) / b.width);
    ctx.drawImage(b, 0, y, width, h);
    y += h + gap;
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

export async function copyImages(urls: string[]): Promise<boolean> {
  if (!canCopyImage()) return false;
  const png = urls.length === 1 ? fetchImage(urls[0]).then(toPng) : stackPng(urls);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  return true;
}

export async function shareImages(urls: string[], name: string): Promise<boolean> {
  if (!canShareFiles()) return false;
  const files = await Promise.all(
    urls.map(async (u, i) => {
      const blob = await fetchImage(u);
      return new File([blob], `${name}-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' });
    }),
  );
  if (!navigator.canShare({ files })) return false;
  try {
    await navigator.share({ files, title: name });
    return true;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return true;
    throw err;
  }
}

/**
 * On a computer there is no share sheet worth the name, so Ulashish opens
 * Telegram's own "send to…" picker (the desktop app when installed, otherwise
 * Telegram Web) with the pictures as links and a caption (owner, 03.11.2026).
 * The recipient sees the previews and opens the full pictures from them.
 */
export function shareToTelegram(urls: string[], caption: string): void {
  const text = [caption, ...urls].join(String.fromCharCode(10));
  const href = `https://t.me/share/url?url=${encodeURIComponent(urls[0] ?? '')}&text=${encodeURIComponent(text)}`;
  window.open(href, '_blank', 'noopener');
}
