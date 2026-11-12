import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  isCityRegionCode,
  isCompleteUzPhoneNumber,
  MAX_PAGE_SIZE,
  normalizeUzPhoneNumber,
  type ClientPublic,
  type Coordinates,
  type OrderPage,
  type OrderPublic,
  type TechPassportRow,
} from '@bigant/shared';
import { api, ApiError } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { useGeoAutofill } from '../../lib/useGeoAutofill';
import { canCopyImage, canShareFiles, copyImages, shareImages, shareToTelegram } from '../../lib/imageShare';
import { ClientGeoFields } from '../ClientGeoFields';
import { LocationPickerLazy } from '../LocationPickerLazy';
import { UzPhoneInput } from '../UzPhoneInput';
import { ActionBtn, ErrorLine, Labeled, ModalShell, OrderStatusChip, inputCls } from './Shell';
import { addDays, tkYmd } from '../../lib/tashkent';
import { safeHref } from '../../lib/safeHref';

/**
 * Behind the gear: the seller's own reference shelf.
 *
 * Three things he reaches for while on the phone — the fleet's papers, his
 * clients, what he has booked — each a window off this one. The windows are
 * read-mostly: a client's details can be corrected here, nothing else is
 * changed from this shelf.
 */
export function DatabaseModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [section, setSection] = useState<'docs' | 'clients' | 'orders' | null>(null);
  const back = () => setSection(null);
  if (section === 'docs') return <FleetDocsModal onClose={back} />;
  if (section === 'clients') return <MyClientsModal onClose={back} />;
  if (section === 'orders') return <OrdersHistoryModal onClose={back} />;

  const rows: Array<['docs' | 'clients' | 'orders', string]> = [
    ['docs', t('sellerBoard.dbDocs')],
    ['clients', t('sellerBoard.dbClients')],
    ['orders', t('sellerBoard.dbOrders')],
  ];
  return (
    <ModalShell title={t('sellerBoard.database')} onClose={onClose}>
      <div className="flex flex-col gap-2">
        {rows.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            className="flex w-full items-center justify-between rounded-xl border border-hairline bg-[#12181f] px-4 py-3.5 text-left text-sm font-semibold text-paper hover:bg-panel2"
          >
            {label}
            <span className="text-lg leading-none text-slate-light">›</span>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

function dmy(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

// --- The fleet's papers ----------------------------------------------------

function FleetDocsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ['seller', 'tech-passports'],
    queryFn: () => api.get<TechPassportRow[]>('/seller/tech-passports'),
  });
  const [open, setOpen] = useState<TechPassportRow | null>(null);
  // Search by the driver's name, the plate or the model (owner, 03.11.2026);
  // the plate matches with or without its spaces ("01s002ss").
  const [q, setQ] = useState('');
  if (open) return <FleetDocDetail row={open} onBack={() => setOpen(null)} />;

  const needle = q.trim().toLowerCase();
  const bare = needle.replace(/\s+/g, '');
  const rows = (list.data ?? []).filter(
    (r) =>
      !needle ||
      (r.driver_name ?? '').toLowerCase().includes(needle) ||
      (r.plate_number ?? '').toLowerCase().replace(/\s+/g, '').includes(bare) ||
      (r.model ?? '').toLowerCase().includes(needle),
  );
  return (
    <ModalShell title={t('sellerBoard.dbDocs')} onClose={onClose}>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('sellerBoard.docsSearch')}
        className={`${inputCls} mb-3`}
        autoFocus
      />
      {list.isLoading ? (
        <div className="py-8 text-center text-sm text-slate-light">{t('notifications.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-light">{t('common.noResults')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <button
              key={row.vehicle_id ?? row.driver_id ?? ''}
              type="button"
              onClick={() => setOpen(row)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-hairline bg-[#12181f] px-3.5 py-3 text-left hover:bg-panel2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-paper">
                  {row.driver_name ?? t('sellerBoard.noDriver')}
                </div>
                <div className="truncate font-mono text-xs text-slate-light">
                  {row.plate_number} · {row.model}
                </div>
              </div>
              <span className="text-lg leading-none text-slate-light">›</span>
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function FleetDocDetail({ row, onBack }: { row: TechPassportRow; onBack: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const hasAny =
    !!row.tech_passport_front_url ||
    !!row.tech_passport_back_url ||
    !!row.license_front_url ||
    !!row.license_back_url;

  const send = useMutation({
    mutationFn: () => api.post<{ sent: number }>(`/fleet-docs/drivers/${row.driver_id}/send-to-me`),
  });
  const sendError = !send.isError
    ? null
    : send.error instanceof ApiError && send.error.message === 'telegram_not_linked'
      ? t('sellerBoard.docsNotLinked')
      : send.error instanceof ApiError && send.error.message === 'no_documents'
        ? t('sellerBoard.docsNone')
        : t('sellerBoard.docsSendFailed');

  const copyText = async () => {
    const line = [row.driver_name, row.plate_number].filter(Boolean).join(' · ');
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the button simply stays as it was */
    }
  };

  return (
    <ModalShell
      title={row.driver_name ?? row.plate_number ?? ''}
      onClose={onBack}
      headerAction={
        <button type="button" onClick={onBack} className="text-sm font-semibold text-brand hover:underline">
          ← {t('sellerBoard.back')}
        </button>
      }
    >
      <div className="mb-4 rounded-xl border border-hairline bg-[#12181f] px-3.5 py-3">
        <div className="font-mono text-sm text-paper">
          {row.plate_number} · {row.model}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-light">
          {row.owner && <span>{t('vehicleForm.owner')}: {row.owner}</span>}
          {row.capacity_kg != null && <span>{t('documents.load')}: {row.capacity_kg} kg</span>}
          {row.length_cm && row.width_cm && row.height_cm && (
            <span>{t('documents.size')}: {row.length_cm}×{row.width_cm}×{row.height_cm} sm</span>
          )}
        </div>
        {(row.license_category || row.license_expires_at || row.license_years != null) && (
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-light">
            {row.license_category && <span>{t('driverForm.licenseCategory')}: {row.license_category}</span>}
            {row.license_expires_at && <span>{t('driverForm.licenseExpires')}: {dmy(row.license_expires_at)}</span>}
            {row.license_years != null && (
              <span>{t('driverDetail.staj')}: {t('driverDetail.years', { n: row.license_years })}</span>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void copyText()}
          className="mt-2 rounded-lg border border-hairline bg-panel2 px-3 py-1.5 text-xs font-bold text-slate-light hover:text-paper"
        >
          {copied ? t('sellerBoard.copied') : t('sellerBoard.copy')}
        </button>
      </div>

      <DocRow
        label={t('sellerBoard.docsTechPassport')}
        caption={[row.driver_name, row.plate_number].filter(Boolean).join(' · ')}
        front={row.tech_passport_front_url}
        back={row.tech_passport_back_url}
      />
      <DocRow
        label={t('sellerBoard.docsLicense')}
        caption={[row.driver_name, row.plate_number].filter(Boolean).join(' · ')}
        front={row.license_front_url}
        back={row.license_back_url}
      />

      {sendError && <ErrorLine msg={sendError} />}
      {send.isSuccess && (
        <div className="mb-3 rounded-lg border border-free/40 bg-free-bg px-3.5 py-2.5 text-sm font-semibold text-free">
          {t('sellerBoard.docsSent', { n: send.data.sent })}
        </div>
      )}
      <ActionBtn
        kind="brand"
        className="w-full"
        disabled={!row.driver_id || !hasAny || send.isPending}
        onClick={() => send.mutate()}
      >
        {send.isPending ? '…' : t('sellerBoard.docsSendToMe')}
      </ActionBtn>
    </ModalShell>
  );
}

/** Both sides of one paper, side by side; one Nusxa and one Ulashish for the pair (owner, 03.11.2026). */
function DocRow({ label, caption, front, back }: { label: string; caption: string; front: string | null; back: string | null }) {
  const { t } = useTranslation();
  const [note, setNote] = useState<string | null>(null);
  const say = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(null), 1800);
  };
  const urls = [front, back].filter((u): u is string => !!u);
  // Two ways out that need no bot: the clipboard for desktop Telegram
  // (Ctrl+V into the chat), the share sheet on a phone.
  const copy = () =>
    copyImages(urls)
      .then((ok) => say(t(ok ? 'sellerBoard.imageCopied' : 'sellerBoard.imageCopyUnsupported')))
      .catch(() => say(t('sellerBoard.imageCopyFailed')));
  // A phone hands the two pictures to its share sheet; a computer opens
  // Telegram's own "send to…" picker with the pictures as links.
  const share = () =>
    canShareFiles()
      ? shareImages(urls, label)
          .then((ok) => (ok ? undefined : shareToTelegram(urls, `${caption} — ${label}`)))
          .catch(() => say(t('sellerBoard.imageCopyFailed')))
      : Promise.resolve(shareToTelegram(urls, `${caption} — ${label}`));
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="mr-auto text-[11px] font-semibold uppercase tracking-wide text-slate-light">{note ?? label}</span>
        {urls.length > 0 && canCopyImage() && (
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded-md border border-hairline bg-panel2 px-2 py-1 text-[11px] font-bold text-slate-light hover:text-paper"
          >
            {t('sellerBoard.copy')}
          </button>
        )}
        {urls.length > 0 && (
          <button
            type="button"
            onClick={() => void share()}
            className="rounded-md border border-hairline bg-panel2 px-2 py-1 text-[11px] font-bold text-slate-light hover:text-paper"
          >
            {t('sellerBoard.share')}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <DocTile url={front} label={t('docPhoto.front')} />
        <DocTile url={back} label={t('docPhoto.back')} />
      </div>
    </div>
  );
}

function DocTile({ url, label }: { url: string | null; label: string }) {
  const { t } = useTranslation();
  return url ? (
    <a href={safeHref(url)} target="_blank" rel="noreferrer" title={label} className="block overflow-hidden rounded-lg border border-hairline bg-[#12181f]">
      {/* The whole card, never a crop of it: a passport is read edge to edge. */}
      <img src={url} alt={label} className="w-full bg-white object-contain" />
      <div className="px-2 py-1.5 text-[11px] text-slate-light">{label}</div>
    </a>
  ) : (
    <div className="flex h-[9.75rem] flex-col items-center justify-center rounded-lg border border-dashed border-hairline text-xs text-slate-light">
      <span>{label}</span>
      <span>{t('sellerBoard.docsNoPhoto')}</span>
    </div>
  );
}

// --- My clients --------------------------------------------------------------

function MyClientsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ['clients', 'mine', 'shelf'],
    queryFn: () => api.get<ClientPublic[]>(`/clients?take=${MAX_PAGE_SIZE}`),
  });
  const [editing, setEditing] = useState<ClientPublic | null>(null);
  if (editing) {
    return (
      <ClientEdit
        client={editing}
        onDone={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ['clients'] });
        }}
      />
    );
  }
  const rows = list.data ?? [];
  return (
    <ModalShell title={t('sellerBoard.dbClients')} onClose={onClose}>
      {list.isLoading ? (
        <div className="py-8 text-center text-sm text-slate-light">{t('notifications.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-light">{t('sellerBoard.clientsNone')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-[#12181f] px-3.5 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-paper">{c.name}</div>
                <div className="font-mono text-xs text-slate-light">{c.phone_number}</div>
                <div className="truncate text-xs text-slate-light">
                  {c.address || (c.lat != null ? `${c.lat.toFixed(5)}, ${c.lng?.toFixed(5)}` : t('locationPicker.notSet'))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(c)}
                className="shrink-0 rounded-lg border border-hairline bg-panel2 px-3 py-2 text-xs font-bold text-slate-light hover:text-paper"
              >
                {t('sellerBoard.clientsEdit')}
              </button>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function ClientEdit({ client, onDone }: { client: ClientPublic; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(client.name);
  const [phone, setPhone] = useState(client.phone_number);
  const [regionCode, setRegionCode] = useState(client.region_code ?? '');
  const [districtCode, setDistrictCode] = useState(client.district_code ?? '');
  const [pin, setPin] = useState<Coordinates | null>(
    client.lat != null && client.lng != null ? { lat: client.lat, lng: client.lng } : null,
  );
  const [address, setAddress] = useState(client.address ?? '');
  const [attempted, setAttempted] = useState(false);
  const autofill = useGeoAutofill({ regionCode, setRegion: setRegionCode, setDistrict: setDistrictCode });

  const valid =
    !!name.trim() && isCompleteUzPhoneNumber(phone) && !!regionCode && (!isCityRegionCode(regionCode) || !!districtCode);
  const blockedBy = !attempted
    ? null
    : !name.trim()
      ? t('sellerBoard.missingName')
      : !regionCode
        ? t('sellerBoard.missingRegion')
        : isCityRegionCode(regionCode) && !districtCode
          ? t('sellerBoard.missingDistrict')
          : !isCompleteUzPhoneNumber(phone)
            ? t('sellerBoard.missingPhone')
            : null;

  const save = useMutation({
    mutationFn: () =>
      api.patch<ClientPublic>(`/clients/${client.id}`, {
        name: name.trim(),
        phone_number: normalizeUzPhoneNumber(phone),
        region_code: regionCode,
        district_code: districtCode || null,
        address: address || null,
        ...(pin ? { lat: pin.lat, lng: pin.lng } : {}),
      }),
    onSuccess: onDone,
  });

  return (
    <ModalShell
      title={client.name}
      onClose={onDone}
      headerAction={
        <button type="button" onClick={onDone} className="text-sm font-semibold text-brand hover:underline">
          ← {t('sellerBoard.back')}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <Labeled label={t('sellerBoard.clientName')}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Labeled>
        <ClientGeoFields
          regionCode={regionCode}
          districtCode={districtCode}
          onRegion={setRegionCode}
          onDistrict={setDistrictCode}
          wrapperClassName="space-y-3"
          labelClassName="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-light"
          selectClassName={inputCls}
          between={
            <LocationPickerLazy
              value={pin}
              regionCode={regionCode}
              districtCode={districtCode}
              theme="dark"
              showMap={false}
              onChange={setPin}
              onAddress={setAddress}
              onResolved={(r) => void autofill(r)}
            />
          }
        />
        {address && (
          <p className="text-xs text-slate-light">
            <span className="font-semibold uppercase tracking-wide">{t('locationPicker.resolvedAddress')}:</span>{' '}
            <span className="text-paper">{address}</span>
          </p>
        )}
        <Labeled label={t('clientForm.phoneNumber')}>
          <UzPhoneInput className={inputCls} value={phone} onChange={setPhone} autoComplete="off" />
        </Labeled>
        {blockedBy && <ErrorLine msg={blockedBy} />}
        {save.isError && <ErrorLine msg={t('sellerBoard.errCreateClient')} />}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <ActionBtn
            kind="brand"
            disabled={save.isPending}
            onClick={() => {
              setAttempted(true);
              if (valid) save.mutate();
            }}
          >
            {save.isPending ? '…' : t('sellerBoard.clientsSave')}
          </ActionBtn>
          <ActionBtn kind="neutral" onClick={onDone}>
            {t('sellerBoard.bekor')}
          </ActionBtn>
        </div>
      </div>
    </ModalShell>
  );
}

// --- My orders ---------------------------------------------------------------

type Range = 'today' | 'week' | 'month' | 'pick';

function ymd(d: Date): string {
  return tkYmd(d);
}

/** First and last day of the span the seller asked for, in Tashkent. */
function spanOf(range: Range, month: string): { from: string; to: string } {
  const today = tkYmd();
  if (range === 'today') return { from: today, to: today };
  if (range === 'week') {
    // Monday to Sunday of this week.
    const day = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const from = addDays(today, -day);
    return { from, to: addDays(from, 6) };
  }
  const ym = range === 'month' ? today.slice(0, 7) : month;
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

function OrdersHistoryModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('month');
  const [month, setMonth] = useState(() => ymd(new Date()).slice(0, 7));
  const { from, to } = useMemo(() => spanOf(range, month), [range, month]);
  const page = useQuery({
    queryKey: ['orders', 'history', from, to],
    queryFn: () => api.get<OrderPage>(`/orders/page?delivery_date_from=${from}&delivery_date_to=${to}&take=100`),
    placeholderData: (prev) => prev,
  });
  const rows = useMemo(
    () =>
      [...(page.data?.items ?? [])].sort(
        (a, b) => new Date(b.delivery_datetime).getTime() - new Date(a.delivery_datetime).getTime(),
      ),
    [page.data],
  );
  const total = page.data?.total ?? 0;

  const chip = (value: Range, label: string) => (
    <button
      type="button"
      onClick={() => setRange(value)}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
        range === value ? 'seller-pill-on' : 'bg-panel2 text-slate-light hover:text-paper'
      }`}
    >
      {label}
    </button>
  );

  return (
    <ModalShell title={t('sellerBoard.dbOrders')} onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chip('today', t('sellerBoard.historyToday'))}
        {chip('week', t('sellerBoard.historyWeek'))}
        {chip('month', t('sellerBoard.historyMonth'))}
        <input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setRange('pick');
          }}
          className={`${inputCls} w-auto py-1.5 ${range === 'pick' ? 'border-brand' : ''}`}
        />
        <span className="ml-auto font-mono text-xs text-slate-light">
          {t('sellerBoard.historyCount', { n: total })}
        </span>
      </div>
      {total > rows.length && <p className="mb-2 text-xs text-slate-light">{t('sellerBoard.historyTooMany')}</p>}
      {page.isLoading ? (
        <div className="py-8 text-center text-sm text-slate-light">{t('notifications.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-light">{t('sellerBoard.historyNone')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((o) => (
            <HistoryRow key={o.id} order={o} />
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function HistoryRow({ order }: { order: OrderPublic }) {
  const when = tkYmd(order.delivery_datetime);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-[#12181f] px-3.5 py-2.5 text-sm">
      <span className="font-mono text-xs text-slate">
        {when.slice(8, 10)}.{when.slice(5, 7)}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold text-paper">{order.client_name}</span>
      <span className="hidden truncate text-xs text-slate-light sm:inline">
        {[order.district_name, order.assigned_driver_name].filter(Boolean).join(' · ')}
      </span>
      <OrderStatusChip status={order.status} />
    </div>
  );
}
