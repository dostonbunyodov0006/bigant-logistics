import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { VehicleDocumentPublic, VehiclePublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card } from './ui';
import { Pager } from './Pager';
import { DocPhotoSlot } from './DocPhotoSlot';
import { ItemActions } from './ItemActions';
import { ConfirmDialog } from './ConfirmDialog';
import { VehicleDocumentFormModal } from './forms/VehicleDocumentFormModal';
import { TZ, daysUntil } from '../lib/tashkent';
import { safeHref } from '../lib/safeHref';

/**
 * A lorry's papers: both sides of the tech passport, then every dated
 * document with its expiry.
 *
 * Drawn on the lorry's own page and on its driver's page, from the same rows
 * the Hujjatlar page reads — so a paper added, changed or removed on any of
 * the three is seen on the other two at once. There is one copy.
 */
const PAGE = 4;

function expiryStatus(expiresAtIso: string): 'expired' | 'soon' | 'ok' {
  const days = daysUntil(expiresAtIso);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
const EXPIRY_TONE: Record<'expired' | 'soon' | 'ok', string> = {
  expired: 'bg-[#fdeaea] text-[#dc2626]',
  soon: 'bg-[#fef6e7] text-[#a15c07]',
  ok: 'bg-[#e6f6ec] text-[#15803d]',
};

/** Every query that draws this lorry's papers, told at once. */
export function invalidateVehiclePapers(vehicleId: string) {
  void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
  void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  void queryClient.invalidateQueries({ queryKey: ['fleet-docs'] });
  void queryClient.invalidateQueries({ queryKey: ['seller', 'tech-passports'] });
  void queryClient.invalidateQueries({ queryKey: ['seller-board'] });
}

export function VehiclePapersCard({ vehicleId }: { vehicleId: string }) {
  const { t } = useTranslation();
  const vehicleQ = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => api.get<VehiclePublic>(`/vehicles/${vehicleId}`),
  });
  const docsQ = useQuery({
    queryKey: ['vehicle', vehicleId, 'documents'],
    queryFn: () => api.get<VehicleDocumentPublic[]>(`/vehicles/${vehicleId}/documents`),
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleDocumentPublic | null>(null);
  const [deleting, setDeleting] = useState<VehicleDocumentPublic | null>(null);
  const [page, setPage] = useState(0);
  const refresh = () => invalidateVehiclePapers(vehicleId);

  const deleteM = useMutation({
    mutationFn: (docId: string) => api.del(`/vehicles/${vehicleId}/documents/${docId}`),
    onSuccess: () => {
      refresh();
      setDeleting(null);
    },
  });
  const setPhoto = (kind: 'tech_front' | 'tech_back') => (base64: string) =>
    api.post(`/fleet-docs/vehicles/${vehicleId}/${kind}`, { base64 }).then(refresh);
  const clearPhoto = (kind: 'tech_front' | 'tech_back') => () =>
    api.del(`/fleet-docs/vehicles/${vehicleId}/${kind}`).then(refresh);

  const v = vehicleQ.data;
  const all = docsQ.data ?? [];
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const safe = Math.min(page, pages - 1);
  const rows = all.slice(safe * PAGE, safe * PAGE + PAGE);

  return (
    <>
      <Card className="mb-6 p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-light">
          {t('vehicleDetail.techPassportPhotos')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DocPhotoSlot label={t('docPhoto.front')} url={v?.tech_passport_front_url ?? null} onUpload={setPhoto('tech_front')} onClear={clearPhoto('tech_front')} />
          <DocPhotoSlot label={t('docPhoto.back')} url={v?.tech_passport_back_url ?? null} onUpload={setPhoto('tech_back')} onClear={clearPhoto('tech_back')} />
        </div>
      </Card>

      <Card className="mb-6 flex flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-light">
            {t('vehicleDetail.documents')}
          </span>
          <button
            type="button"
            className="text-sm font-medium text-brand hover:underline"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + {t('vehicleDetail.addDocument')}
          </button>
        </div>
        {all.length === 0 ? (
          <div className="flex-1 py-2 text-sm text-slate-light">{t('vehicleDetail.noDocs')}</div>
        ) : (
          <div className="flex-1 divide-y divide-mist/60">
            {rows.map((d) => {
              const status = expiryStatus(d.expires_at);
              return (
                <div key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    {d.photo_url && (
                      <a href={safeHref(d.photo_url)} target="_blank" rel="noreferrer" className="shrink-0">
                        <img src={d.photo_url} alt="" className="h-10 w-14 rounded border border-mist object-cover" />
                      </a>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">
                        {t(`vehicleDocType.${d.type}`)}
                        {d.holder_name ? <span className="ml-2 text-slate">{d.holder_name}</span> : null}
                        {d.number ? <span className="ml-2 font-mono text-xs text-slate">{d.number}</span> : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs">
                        <span className="text-slate">
                          {t('vehicleDetail.expires')}: {new Date(d.expires_at).toLocaleDateString(undefined, { timeZone: TZ })}
                        </span>
                        {status !== 'ok' && (
                          <span className={`rounded-full px-2 py-0.5 font-medium ${EXPIRY_TONE[status]}`}>
                            {status === 'expired' ? t('vehicleDetail.expired') : t('vehicleDetail.expiringSoon')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <ItemActions
                      size="sm"
                      onEdit={() => {
                        setEditing(d);
                        setFormOpen(true);
                      }}
                      onDelete={() => setDeleting(d)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Pager page={safe} count={pages} onPage={setPage} />
      </Card>

      <VehicleDocumentFormModal
        open={formOpen}
        vehicleId={vehicleId}
        editing={editing}
        onClose={() => setFormOpen(false)}
      />
      <ConfirmDialog
        open={!!deleting}
        title={t('vehicleDetail.deleteDocTitle')}
        message={t('vehicleDetail.deleteDocMessage')}
        pending={deleteM.isPending}
        error={deleteM.isError ? deleteM.error : undefined}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteM.mutate(deleting.id)}
      />
    </>
  );
}
