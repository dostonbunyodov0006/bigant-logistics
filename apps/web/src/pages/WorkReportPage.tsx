import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, PageHeader } from '../components/ui';
import { IdleReport } from '../components/IdleReport';
import { tkMonthStart, tkYmd } from '../lib/tashkent';

/**
 * Ish vaqti hisoboti (owner, 05.11.2026): one table — for each lorry or each
 * driver, from "Ishni boshlash" to "Ishni tugatish", how long he worked, how
 * long on orders and how long idle, day by day.
 */
export function WorkReportPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(tkMonthStart());
  const [to, setTo] = useState(tkYmd(new Date()));

  return (
    <div>
      <PageHeader title={t('workReport.title')} />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="wr-from">
              {t('workReport.from')}
            </label>
            <input id="wr-from" type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="wr-to">
              {t('workReport.to')}
            </label>
            <input id="wr-to" type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <IdleReport from={from} to={to} />
    </div>
  );
}
