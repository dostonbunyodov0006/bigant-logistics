import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PayrollDriverRow, PayrollDrivers } from '@bigant/shared';
import { api } from '../lib/api';
import { Card, DataTable, EmptyState, ErrorNote, PageHeader, Spinner, Tabs, type Column } from '../components/ui';
import { FinesPage } from './FinesPage';
import { bonusPeriodLabel, bonusPeriodLocked, bonusPeriodOf, shiftBonusPeriod, type BonusPeriod } from '../lib/bonusPeriod';


/** Hands the browser a workbook the server sent as base64. */
export function saveXlsx({ filename, base64 }: { filename: string; base64: string }) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The period in the address, so the driver's page and a reload keep it. */
export function usePeriodParam(): [BonusPeriod, (p: BonusPeriod) => void] {
  const [params, setParams] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const period = from && to ? { from, to } : bonusPeriodOf();
  // The tab this page sits in (?bolim=fines) must survive picking a period.
  const bolim = params.get('bolim');
  return [period, (p) => setParams({ ...(bolim ? { bolim } : {}), from: p.from, to: p.to }, { replace: true })];
}

export function PeriodPicker({ period, onChange }: { period: BonusPeriod; onChange: (p: BonusPeriod) => void }) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-lg border border-mist bg-white">
        <button
          type="button"
          className="px-3 py-2 text-slate hover:text-ink"
          aria-label={t('payroll.prevPeriod')}
          onClick={() => onChange(shiftBonusPeriod(period, -1))}
        >
          ‹
        </button>
        <span className="px-1 font-mono text-sm font-semibold text-ink">{bonusPeriodLabel(period)}</span>
        <button
          type="button"
          className="px-3 py-2 text-slate hover:text-ink"
          aria-label={t('payroll.nextPeriod')}
          onClick={() => onChange(shiftBonusPeriod(period, 1))}
        >
          ›
        </button>
      </div>
      {bonusPeriodLocked(period) && <span className="text-xs text-slate">{t('payroll.periodLocked')}</span>}
    </div>
  );
}

/** "Achilov Donyor" → surname Achilov, name Donyor; a single word is the name. */
function splitName(full: string | null): { surname: string; name: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { surname: '—', name: parts[0] ?? '—' };
  return { surname: parts[0]!, name: parts.slice(1).join(' ') };
}

/** Ish haqi: the drivers and their three bonuses for the period (owner, 29.10.2026). */
export function PayrollPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Jarimalar is a tab here, not a menu entry (owner, 02.11.2026): a fine is
  // taken off the pay. The pick is in the address (?bolim=fines).
  const [addr, setAddr] = useSearchParams();
  const bolim: 'pay' | 'fines' = addr.get('bolim') === 'fines' ? 'fines' : 'pay';
  const embedded = false;
  const [period, setPeriod] = usePeriodParam();
  const qs = `from=${period.from}&to=${period.to}`;

  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'drivers', qs],
    queryFn: () => api.get<PayrollDrivers>(`/payroll/drivers?${qs}`),
  });
  const rows = data?.rows ?? [];

  // The workbook the mini app used to give: Ишбай, Юк олиш, Юк топшириш,
  // Ходимлар Жами, Жами сумма (owner, 29.10.2026).
  const excelM = useMutation({
    mutationFn: () => api.get<{ filename: string; base64: string }>(`/payroll/export?${qs}`),
    onSuccess: saveXlsx,
  });

  const columns: Column<PayrollDriverRow>[] = [
    // Names are kept as "Familiya Ism"; the first word is the surname.
    { key: 'surname', header: t('payroll.colSurname'), render: (r) => <span className="font-medium text-brand">{splitName(r.driver_name).surname}</span> },
    { key: 'name', header: t('payroll.colName'), render: (r) => <span className="font-medium text-brand">{splitName(r.driver_name).name}</span> },
    { key: 'plate', header: t('payroll.colPlate'), render: (r) => <span className="font-mono text-ink">{r.plate_number ?? '—'}</span> },
    { key: 'model', header: t('payroll.colModel'), render: (r) => <span className="text-slate">{r.vehicle_model ?? '—'}</span> },
  ];

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={t('payroll.title')}
          actions={
            <button type="button" className="btn-ghost" disabled={excelM.isPending} onClick={() => excelM.mutate()}>
              {t('payroll.downloadExcel')}
            </button>
          }
        />
      )}
      <Tabs<'pay' | 'fines'>
        tabs={[
          { value: 'pay', label: t('payroll.tabMain') },
          { value: 'fines', label: t('nav.fines') },
        ]}
        active={bolim}
        onChange={(k) => setAddr(k === 'pay' ? {} : { bolim: k }, { replace: true })}
      />
      {bolim === 'fines' ? (
        <FinesPage embedded />
      ) : (
        <>

      <div className="mb-4">
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>

      {excelM.isError ? <ErrorNote error={excelM.error} /> : null}

      {isLoading ? (
        <Card>
          <Spinner />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={t('payroll.noData')} />
        </Card>
      ) : (
        // Only the drivers here; each one's bonuses are on his own page (owner, 29.10.2026).
        <Card>
          <DataTable
            columns={columns}
            rows={rows}
            keyOf={(r) => r.driver_id}
            onRowClick={(r) => navigate(`/payroll/${r.driver_id}?${qs}`)}
          />
        </Card>
      )}
        </>
      )}
    </div>
  );
}
