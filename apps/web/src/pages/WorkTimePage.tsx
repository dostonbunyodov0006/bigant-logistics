import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AttendancePage } from './AttendancePage';
import { WorkReportPage } from './WorkReportPage';
import { LeavePage } from './LeavePage';
import { Card } from '../components/ui';

/** Dam kuni: the place is kept; what goes in it comes later (owner, 30.10.2026). */
function DayOffPage() {
  return <Card className="min-h-[240px]">{null}</Card>;
}

const SECTIONS = [
  { key: 'hours', label: 'nav.workHours' },
  { key: 'attendance', label: 'nav.attendance' },
  { key: 'dayoff', label: 'nav.dayOffSection' },
  { key: 'leave', label: 'nav.leave' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'] | 'report';

/**
 * Ish vaqti: one press in the sidebar, and its parts sit side by side on top
 * as Sozlamalar's do (owner, 30.10.2026). The pick is in the address
 * (?bolim=attendance) so a refresh or a link keeps it.
 */
export function WorkTimePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const picked = params.get('bolim');
  const current = SECTIONS.find((s) => s.key === picked) ?? SECTIONS[0];
  const pick = (key: SectionKey) => setParams(key === 'hours' ? {} : { bolim: key }, { replace: true });

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => pick(s.key)}
            aria-pressed={current.key === s.key}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
              current.key === s.key
                ? 'border-brand bg-brand text-white'
                : 'border-mist bg-white text-ink hover:border-brand hover:text-brand-dark'
            }`}
          >
            {t(s.label)}
          </button>
        ))}
      </div>
      {current.key === 'hours' ? (
        <WorkReportPage />
      ) : current.key === 'attendance' ? (
        <AttendancePage />
      ) : current.key === 'dayoff' ? (
        <DayOffPage />
      ) : (
        <LeavePage />
      )}
    </div>
  );
}
