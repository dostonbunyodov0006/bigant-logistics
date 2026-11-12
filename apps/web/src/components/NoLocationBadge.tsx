import { useTranslation } from 'react-i18next';

/**
 * Marks a client or pickup place that predates the map picker. Anything created
 * from such a row has no ETA and is invisible to routing, so the point of the
 * badge is to make the 27 legacy rows findable rather than forgotten — staff
 * pin them deliberately through the edit form.
 */
export function NoLocationBadge() {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
      title={t('locationPicker.required')}
    >
      <span aria-hidden>📍</span>
      {t('locationPicker.notSet')}
    </span>
  );
}
