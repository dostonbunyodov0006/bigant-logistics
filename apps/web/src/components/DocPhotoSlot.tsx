import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fileToJpegBase64 } from '../lib/imageFile';
import { safeHref } from '../lib/safeHref';

/**
 * One side of one document: the picture if the office has taken it, and the
 * means to take, replace or remove it.
 *
 * The admin pages show four of these — both sides of the tech passport on the
 * lorry, both sides of the licence on the driver — so the behaviour lives
 * here once: pick a file, shrink it in the browser, hand the bytes up.
 */
export function DocPhotoSlot({
  label,
  url,
  onUpload,
  onClear,
  pending,
}: {
  label: string;
  url: string | null;
  onUpload: (base64: string) => Promise<unknown>;
  onClear: () => Promise<unknown>;
  pending?: boolean;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    try {
      await onUpload(await fileToJpegBase64(file));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const working = busy || !!pending;
  return (
    <div className="rounded-lg border border-mist p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-light">{label}</div>
      {url ? (
        <a href={safeHref(url)} target="_blank" rel="noreferrer" className="block">
          <img src={url} alt={label} className="max-h-48 w-full rounded-md border border-mist object-contain bg-paper" />
        </a>
      ) : (
        <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-mist text-sm text-slate-light">
          {t('docPhoto.none')}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn-ghost" disabled={working} onClick={() => input.current?.click()}>
          {working ? t('common.saving') : url ? t('docPhoto.replace') : t('docPhoto.upload')}
        </button>
        {url && (
          <button
            type="button"
            className="btn-ghost text-[#dc2626]"
            disabled={working}
            onClick={() => {
              setBusy(true);
              void onClear().finally(() => setBusy(false));
            }}
          >
            {t('docPhoto.remove')}
          </button>
        )}
        {failed && <span className="text-xs font-medium text-[#dc2626]">{t('docPhoto.failed')}</span>}
      </div>
    </div>
  );
}
