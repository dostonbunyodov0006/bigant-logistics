import { useTranslation } from 'react-i18next';

/**
 * The pencil and the bin.
 *
 * Where a row opens a page of its own, this belongs in that page's header: a
 * list is for finding someone, and a delete sitting beside a name is how the
 * wrong one goes. Where there is no page to open — a pickup place, a tariff,
 * an address — it stays on the row as `size="sm"`, as two marks rather than
 * two words, so the row reads as what it is and not as what can be done to it.
 */
export function ItemActions({
  onEdit,
  onDelete,
  /** Deactivating is not deleting: the bin would be a lie on a staff account. */
  deleteIcon = 'bin',
  deleteLabel,
  editLabel,
  /** 'sm' for a table row, where the pair must not outweigh the row itself. */
  size = 'md',
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  deleteIcon?: 'bin' | 'block';
  deleteLabel?: string;
  editLabel?: string;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const removeLabel = deleteLabel ?? t('common.delete');
  const changeLabel = editLabel ?? t('common.edit');
  const px = size === 'sm' ? 16 : 18;
  const box =
    size === 'sm'
      ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-mist bg-white transition hover:bg-paper'
      : 'btn-ghost px-2.5';
  return (
    <>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={changeLabel}
          title={changeLabel}
          className={`${box} text-graphite hover:text-brand`}
        >
          <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={removeLabel}
          title={removeLabel}
          className={`${box} text-[#dc2626] hover:bg-[#fdeaea]`}
        >
          <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {deleteIcon === 'block' ? (
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="M5.6 5.6l12.8 12.8" />
              </>
            ) : (
              <>
                <path d="M3 6h18" />
                <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </>
            )}
          </svg>
        </button>
      )}
    </>
  );
}
