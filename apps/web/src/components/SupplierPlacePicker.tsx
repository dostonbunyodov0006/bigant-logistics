import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PickupPlacePublic } from '@bigant/shared';
import { api } from '../lib/api';

/** How a supplier's place reads in the list: "Artel · Chilonzor", or just its name. */
export function supplierPlaceLabel(p: Pick<PickupPlacePublic, 'name' | 'supplier_name'>): string {
  const s = p.supplier_name?.trim();
  return s && !p.name.toLowerCase().includes(s.toLowerCase()) ? `${s} · ${p.name}` : p.name;
}

/**
 * Ta'minotchi for a return (owner, 12.11.2026): the list of suppliers' places,
 * with a search, so the seller picks which supplier the goods go back to and
 * the driver can ring it. Our own shop and warehouse are not on it.
 */
export function SupplierPlacePicker({
  value,
  onPick,
  tone,
}: {
  value: string | null;
  onPick: (placeId: string) => void;
  tone: 'dark' | 'light';
}) {
  const [q, setQ] = useState('');
  const placesQ = useQuery({
    queryKey: ['pickup-places'],
    queryFn: () => api.get<PickupPlacePublic[]>('/pickup-places'),
    staleTime: 5 * 60_000,
  });
  const suppliers = useMemo(
    () =>
      (placesQ.data ?? [])
        .filter((p) => p.type !== 'warehouse' && p.type !== 'market' && (p.supplier_id || p.type === 'custom'))
        .sort((a, b) => supplierPlaceLabel(a).localeCompare(supplierPlaceLabel(b), 'uz')),
    [placesQ.data],
  );
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? suppliers.filter((p) =>
        [supplierPlaceLabel(p), p.district_name, p.region_name, p.address, p.phone_number]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(needle)),
      )
    : suppliers;
  const chosen = suppliers.find((p) => p.id === value) ?? null;
  const dark = tone === 'dark';
  return (
    <div className={`mt-2 rounded-lg border p-2.5 ${dark ? 'border-hairline bg-panel2' : 'border-mist bg-white'}`}>
      {chosen && (
        <div className={`mb-2 text-sm font-bold ${dark ? 'text-free' : 'text-brand-dark'}`}>
          ✓ {supplierPlaceLabel(chosen)}
          {chosen.phone_number ? <span className="ml-2 font-mono text-xs font-semibold opacity-80">{chosen.phone_number}</span> : null}
        </div>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Postavshikni qidiring…"
        className={`w-full rounded-md border px-3 py-2 text-sm outline-none ${
          dark ? 'border-hairline bg-panel text-paper placeholder:text-slate' : 'border-mist bg-paper text-ink'
        }`}
      />
      <div className="mt-2 max-h-56 overflow-y-auto">
        {placesQ.isLoading ? (
          <div className="px-1 py-2 text-sm text-slate">…</div>
        ) : shown.length === 0 ? (
          <div className="px-1 py-2 text-sm text-slate">Topilmadi</div>
        ) : (
          shown.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm ${
                p.id === value
                  ? 'bg-brand text-white'
                  : dark
                    ? 'text-paper hover:bg-panel'
                    : 'text-ink hover:bg-paper'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{supplierPlaceLabel(p)}</span>
                {(p.district_name || p.region_name) && (
                  <span className={`block truncate text-xs ${p.id === value ? 'text-white/80' : 'text-slate'}`}>
                    {[p.district_name, p.region_name].filter(Boolean).join(', ')}
                  </span>
                )}
              </span>
              {p.phone_number ? <span className="shrink-0 font-mono text-xs opacity-80">📞</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
