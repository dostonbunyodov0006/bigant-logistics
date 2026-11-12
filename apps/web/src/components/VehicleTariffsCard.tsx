import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { VEHICLE_CATEGORIES, type VehicleCategory, type VehicleTariffsResponse } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, ErrorNote, Spinner, ValidationNote } from './ui';

const NUM_KEYS = [
  'daily_wage_som',
  'pickup_city_som',
  'pickup_outside_som',
  'delivery_city_som',
  'delivery_outside_som',
  'early_hour_som',
] as const;
type NumKey = (typeof NUM_KEYS)[number];
// Fields are edited as strings so the input can be emptied (backspace) freely;
// they are parsed to non-negative integers only on save.
type Draft = Record<VehicleCategory, Record<NumKey, string>>;

const blankRow = (): Record<NumKey, string> =>
  Object.fromEntries(NUM_KEYS.map((k) => [k, ''])) as Record<NumKey, string>;
const blankDraft = (): Draft =>
  Object.fromEntries(VEHICLE_CATEGORIES.map((c) => [c, blankRow()])) as Draft;

const toInt = (s: string): number => Math.max(0, Math.floor(Number(s) || 0));

// The four rate fields (daily wage and the early-hour price are rendered separately).
type RateKey = Exclude<NumKey, 'daily_wage_som' | 'early_hour_som'>;

export function VehicleTariffsCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'vehicle-tariffs'],
    queryFn: () => api.get<VehicleTariffsResponse>('/settings/vehicle-tariffs'),
  });

  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [seeded, setSeeded] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (data && !seeded) {
      const next = blankDraft();
      for (const trf of data.tariffs) {
        for (const k of NUM_KEYS) next[trf.category][k] = String(trf[k]);
      }
      setDraft(next);
      setSeeded(true);
    }
  }, [data, seeded]);

  const saveM = useMutation({
    mutationFn: () =>
      api.put<VehicleTariffsResponse>('/settings/vehicle-tariffs', {
        tariffs: VEHICLE_CATEGORIES.map((c) => ({
          category: c,
          ...(Object.fromEntries(NUM_KEYS.map((k) => [k, toInt(draft[c][k])])) as Record<NumKey, number>),
        })),
      }),
    onSuccess: () => {
      setAttempted(false);
      void queryClient.invalidateQueries({ queryKey: ['settings', 'vehicle-tariffs'] });
    },
  });

  const setField = (cat: VehicleCategory, key: NumKey, value: string) =>
    setDraft((cur) => ({ ...cur, [cat]: { ...cur[cat], [key]: value } }));

  const invalidFields = VEHICLE_CATEGORIES.flatMap((cat) =>
    NUM_KEYS.filter((key) => {
      const value = draft[cat][key];
      return value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0;
    }).map((key) => `t-${cat}-${key}`),
  );
  const save = () => {
    setAttempted(true);
    if (invalidFields[0]) {
      document.getElementById(invalidFields[0])?.focus();
      return;
    }
    saveM.mutate();
  };

  const numField = (cat: VehicleCategory, key: NumKey, label: string, step = 1000) => (
    <div>
      <label className="field-label" htmlFor={`t-${cat}-${key}`}>
        {label}
      </label>
      <input
        id={`t-${cat}-${key}`}
        type="number"
        min={0}
        step={step}
        inputMode="numeric"
        className="input"
        value={draft[cat][key]}
        onChange={(e) => setField(cat, key, e.target.value)}
      />
    </div>
  );

  const rateRow = (cat: VehicleCategory, city: RateKey, outside: RateKey, cityLabel: string, outsideLabel: string) => (
    <div className="grid grid-cols-2 gap-4">
      {numField(cat, city, cityLabel)}
      {numField(cat, outside, outsideLabel)}
    </div>
  );

  return (
    <Card className="max-w-2xl p-5">
      <div className="mb-4">
        <h2 className="font-display text-lg font-bold tracking-tight">{t('vehicleTariffs.title')}</h2>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="space-y-6">
            {VEHICLE_CATEGORIES.map((cat) => (
              <div key={cat} className="rounded-lg border border-mist p-4">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-dark">
                  {t(`vehicleTariffs.${cat}`)}
                </h3>
                <div className="mb-4 max-w-[220px]">
                  {numField(cat, 'daily_wage_som', t('vehicleTariffs.dailyWage'))}
                </div>
                <div className="space-y-3">
                  {rateRow(cat, 'pickup_city_som', 'pickup_outside_som', t('vehicleTariffs.pickupCity'), t('vehicleTariffs.pickupOutside'))}
                  {rateRow(cat, 'delivery_city_som', 'delivery_outside_som', t('vehicleTariffs.deliveryCity'), t('vehicleTariffs.deliveryOutside'))}
                </div>
                {/* The hourly rate for early starts and evenings; the per-km Viloyat rate is gone (owner, 07.11.2026). */}
                <div className="-mx-2 mt-4 flex flex-wrap items-end gap-4 rounded-lg bg-brand-tint px-2 py-3">
                  <div className="w-[220px]">{numField(cat, 'early_hour_som', t('vehicleTariffs.earlyHour'))}</div>
                </div>
              </div>
            ))}
          </div>

          <ValidationNote show={attempted && invalidFields.length > 0} />

          {saveM.isError && (
            <div className="mt-4">
              <ErrorNote error={saveM.error} />
            </div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={saveM.isPending}
              onClick={save}
            >
              {saveM.isPending ? t('common.saving') : t('vehicleTariffs.save')}
            </button>
            {saveM.isSuccess && !saveM.isPending && (
              <span className="text-sm font-medium text-[#15803d]">{t('vehicleTariffs.saved')}</span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
