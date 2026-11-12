import { useEffect, type ReactNode } from 'react';

const WIDTH = { md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** A form fits `md`; a photo beside a map needs `xl`. */
  size?: keyof typeof WIDTH;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 flex max-h-[90vh] w-full ${WIDTH[size]} flex-col rounded-xl border border-mist bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-mist px-5 py-4">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate transition hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {/* Scrolls independently of the header, so a tall form (the map picker
            adds ~260px) never pushes its own Save button off-screen. */}
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
