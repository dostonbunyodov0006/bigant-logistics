import { useTranslation } from 'react-i18next';

/**
 * The seller board's own furniture: the dark modal, its buttons, its labelled
 * field and its error line. The board is painted in its own palette rather
 * than the console's, so anything that opens over it is built from these.
 */

export const inputCls =
  'w-full rounded-lg border border-hairline bg-panel2 px-3 py-2.5 text-sm text-paper placeholder:text-slate outline-none focus:border-brand';

export function ModalShell({
  title,
  onClose,
  headerAction,
  minimize,
  children,
}: {
  title: string;
  onClose: () => void;
  headerAction?: React.ReactNode;
  /**
   * The window folds away rather than closing: a minus, not a cross.
   *
   * A cross is a promise that the thing goes away, and on a form holding a
   * seven-minute hold on a lorry that promise is wrong — the booking stands
   * either way. The sign now says what happens.
   */
  minimize?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-4 pt-10">
      <div className="w-full max-w-2xl rounded-2xl border border-hairline bg-panel p-5 text-paper shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <div className="flex items-center gap-4">
            {headerAction}
            <button
              type="button"
              onClick={onClose}
              aria-label={minimize ? t('sellerBoard.minimize') : 'Close'}
              title={minimize ? t('sellerBoard.minimizeHint') : undefined}
              className="h-8 w-8 rounded-lg border border-hairline bg-panel2 text-lg font-bold leading-none text-slate-light hover:text-paper"
            >
              {minimize ? '−' : '×'}
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ActionBtn({
  kind,
  children,
  onClick,
  disabled,
  className = '',
}: {
  kind: 'brand' | 'brand2' | 'neutral' | 'outline' | 'danger';
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const styles: Record<string, string> = {
    brand: 'bg-brand text-white hover:bg-brand-dark',
    brand2: 'bg-brand-dark text-white hover:brightness-110',
    neutral: 'bg-panel2 border border-hairline text-paper hover:bg-[#28303d]',
    outline: 'bg-transparent border border-[#3a4453] text-paper hover:bg-panel2',
    danger: 'bg-full text-white hover:brightness-110',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-3.5 text-[15px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[kind]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Labeled({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className={error ? '[&_input]:border-[#dc2626] [&_select]:border-[#dc2626]' : undefined}>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-light">
        {label}
      </div>
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-[#ef4444]">
          {error}
        </p>
      )}
    </div>
  );
}

export function ErrorLine({ msg }: { msg: string }) {
  return (
    <div className="mb-3 rounded-lg border border-full/40 bg-full-bg px-3.5 py-2.5 text-sm font-semibold text-full">
      {msg}
    </div>
  );
}

export function OrderStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone =
    status === 'delivered' || status === 'returned'
      ? 'bg-free-bg text-free'
      : status === 'cancelled' || status === 'problem'
        ? 'bg-full-bg text-full'
        : status === 'returning'
          ? 'bg-booked/15 text-booked'
          : 'bg-brand/15 text-brand';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
      {t(`orderStatus.${status as 'created'}`)}
    </span>
  );
}
