import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function PageHeader({
  title,
  actions,
}: {
  title: string;
  /** Accepted but not shown: no explanatory line under a page title (owner, 28.10.2026). */
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
      </div>
      {actions}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-xl border border-mist bg-white shadow-card', className)}>
      {children}
    </div>
  );
}

/**
 * Underlined tab strip. Purely presentational: the caller owns the active value,
 * so it works with local state or (preferably) a URL query param.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { value: T; label: string }[];
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 border-b border-mist">
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={clsx(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition',
              isActive
                ? 'border-brand text-brand-dark'
                : 'border-transparent text-slate hover:border-mist hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-slate">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-mist border-t-brand" />
      {label ?? t('common.loading')}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-12 text-center">
      <div className="font-display text-sm font-semibold text-graphite">{title}</div>
      {hint && <div className="mx-auto mt-1 max-w-sm text-sm text-slate">{hint}</div>}
    </div>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        error &&
          '[&_.input]:border-[#dc2626] [&_.input]:focus:border-[#dc2626] [&_.input]:focus:ring-[#dc2626]/20',
      )}
    >
      <label className="field-label">{label}</label>
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-[#dc2626]">
          {error}
        </p>
      )}
    </div>
  );
}

export function ValidationNote({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <div role="alert" className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm font-medium text-[#dc2626]">
      {t('common.completeRequiredFields')}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  let message: string;
  if (error instanceof Error) {
    const key = `errors.${error.message}` as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message = i18n.exists(key) ? (t as any)(key) : error.message;
  } else {
    message = t('errors.generic');
  }
  return <div className="rounded-lg bg-[#fdeaea] px-3 py-2 text-sm text-[#dc2626]">{message}</div>;
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  keyOf,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-mist text-left text-xs uppercase tracking-wide text-slate-light">
            {columns.map((c) => (
              <th key={c.key} className={clsx('px-4 py-3 font-medium', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyOf(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={clsx(
                'border-b border-mist/60 last:border-0 hover:bg-paper/60',
                onRowClick && 'cursor-pointer',
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={clsx('px-4 py-3 text-graphite', c.className)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
