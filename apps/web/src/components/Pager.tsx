import { tkYmd } from '../lib/tashkent';
// Reusable pagination controls + date-range filter, shared by the detail pages
// (vehicle & driver) for their mileage / documents / incidents / work-shift lists.


/** Local YYYY-MM-DD for an ISO timestamp — used by the date-range filters. */
/** The Tashkent day of a moment, for the date filters. */
export function localYmd(iso: string): string {
  return tkYmd(iso);
}

/** Whether a YYYY-MM-DD falls within an inclusive [from, to] range (either side optional). */
export function inRange(ymd: string, from: string, to: string): boolean {
  return (!from || ymd >= from) && (!to || ymd <= to);
}

export function Pager({
  page,
  count,
  onPage,
  size = 'sm',
}: {
  page: number;
  count: number;
  onPage: (p: number) => void;
  size?: 'sm' | 'lg';
}) {
  if (count <= 1) return null;
  const lg = size === 'lg';
  const btn = lg
    ? 'flex h-10 w-10 items-center justify-center rounded-lg border border-mist text-2xl font-semibold leading-none text-brand transition hover:bg-brand-tint hover:border-brand disabled:cursor-not-allowed disabled:border-mist/60 disabled:text-slate-light disabled:hover:bg-transparent'
    : 'rounded px-2 py-0.5 text-xs font-medium text-brand hover:underline disabled:text-slate-light disabled:no-underline';
  return (
    <div
      className={`flex items-center justify-between border-t border-mist/60 ${
        lg ? 'mt-4 pt-3' : 'mt-3 pt-2 text-xs'
      }`}
    >
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
        className={btn}
      >
        ‹
      </button>
      <span className={`font-mono text-slate ${lg ? 'text-sm font-medium' : ''}`}>
        {page + 1} / {count}
      </span>
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= count - 1}
        onClick={() => onPage(page + 1)}
        className={btn}
      >
        ›
      </button>
    </div>
  );
}

/** Inline "from – to" date-range (calendar) filter with a clear button. */
export function DateRangeFilter({
  from,
  to,
  onFrom,
  onTo,
  onClear,
  clearLabel,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        className="input max-w-[140px] px-2 py-1 text-xs"
        value={from}
        max={to || undefined}
        onChange={(e) => onFrom(e.target.value)}
      />
      <span className="text-xs text-slate-light">–</span>
      <input
        type="date"
        className="input max-w-[140px] px-2 py-1 text-xs"
        value={to}
        min={from || undefined}
        onChange={(e) => onTo(e.target.value)}
      />
      {(from || to) && (
        <button
          type="button"
          className="text-xs font-medium text-brand hover:underline"
          onClick={onClear}
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
