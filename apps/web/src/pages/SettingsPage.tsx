import { useSearchParams } from 'react-router-dom';
import { WorkHoursPage } from './WorkHoursPage';
import { useTranslation } from 'react-i18next';
import { Card, PageHeader } from '../components/ui';
import { VehicleTariffsCard } from '../components/VehicleTariffsCard';
import { WorkScheduleEditor } from '../components/WorkScheduleEditor';
import { CargoTypesCard } from '../components/CargoTypesCard';
import { TelegramReportsCard } from '../components/TelegramReportsCard';

// Kunlik ish soati moved under Ish vaqti (WorkHoursPage, 30.10.2026).
const SECTIONS = ['schedule', 'tariffs', 'cargo', 'telegram'] as const;
type Section = (typeof SECTIONS)[number];

/**
 * The settings, one at a time: a row of buttons on top, and the one picked
 * underneath — they were stacked down the page and the lower ones went
 * unseen. The pick is in the address (?bolim=tariffs) so it survives a refresh.
 */
export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const picked = params.get('bolim');
  const section: Section = (SECTIONS as readonly string[]).includes(picked ?? '') ? (picked as Section) : 'schedule';
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="mb-6 flex flex-wrap gap-2">
        {SECTIONS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setParams(k === 'schedule' ? {} : { bolim: k }, { replace: true })}
            aria-pressed={section === k}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
              section === k
                ? 'border-brand bg-brand text-white'
                : 'border-mist bg-white text-ink hover:border-brand hover:text-brand-dark'
            }`}
          >
            {t(`settings.section.${k}`)}
          </button>
        ))}
      </div>


      {/* Per-weekday hours. Weekdays left unset here follow the single
          shift window above, so this is purely opt-in. */}
      {/* The working day: the one window for the week (owner, 03.11.2026 — it
          sat under Ish vaqti, a report page, and the shift times showed in two
          places), then the weekdays that differ from it. */}
      {section === 'schedule' && (
        <>
          <div className="mb-6">
            <WorkHoursPage embedded />
          </div>
          <Card className="max-w-xl p-5">
            <h2 className="mb-4 text-base font-semibold text-ink">{t('schedule.title')}</h2>
            <WorkScheduleEditor />
          </Card>
        </>
      )}

      {section === 'tariffs' && <VehicleTariffsCard />}
      {section === 'cargo' && <CargoTypesCard />}
      {section === 'telegram' && <TelegramReportsCard />}
    </div>
  );
}
