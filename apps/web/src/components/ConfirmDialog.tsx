import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { ErrorNote } from './ui';

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  pending?: boolean;
  error?: unknown;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {error ? <ErrorNote error={error} /> : null}
        {message ? <p className="text-sm text-slate">{message}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn !bg-[#dc2626] text-white hover:!bg-[#b91c1c]"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? t('common.working') : (confirmLabel ?? t('common.delete'))}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
