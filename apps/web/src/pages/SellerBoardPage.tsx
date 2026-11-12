import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';
import logoDark from '../assets/logo-dark.png';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  PoputiSearchResult,
  BoardResponse,
  BoardVehicle,
  BoardView,
  BookingMode,
  BookingSession,
  BookingSlot,
  CargoTypePublic,
  ClientAddressPublic,
  ClientPublic,
  OrderExceptionReason,
  OrderPage,
  NotificationPublic,
  OrderPublic,
  PickupPlacePublic,
  ReserveResult,
  SellerOrder,
  VehicleQueue,
} from '@bigant/shared';
import {
  CANCELLABLE_ORDER_STATUSES,
  isCityRegionCode,
  isCompleteUzPhoneNumber,
  normalizeUzPhoneNumber,
  ORDER_EXCEPTION_REASONS,
  UZ_PHONE_PREFIX,
  type Coordinates,
  type PendingHold,
} from '@bigant/shared';
import { useAuth } from '../auth/AuthContext';
import { ActionBtn, ErrorLine, Labeled, ModalShell, OrderStatusChip, inputCls } from '../components/seller/Shell';
import { CompanyJobForm } from '../components/seller/CompanyJobForm';
import { DatabaseModal } from '../components/seller/DatabaseModals';
import { api, ApiError } from '../lib/api';
import { useBoardBase } from '../lib/boardBase';
import { queryClient } from '../lib/queryClient';
import { ClientGeoFields } from '../components/ClientGeoFields';
import { LocationPickerLazy } from '../components/LocationPickerLazy';
import { useGeoAutofill } from '../lib/useGeoAutofill';
import { SellerEta } from '../components/SellerEta';
import { PickupPlaceCreator } from '../components/SellerPickupPlaceCreator';
import { formatDateTime } from '../lib/format';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { getSellerTheme, setSellerTheme, type SellerTheme } from '../lib/sellerTheme';
import { getAppliedTheme } from '../lib/theme';
import { toward } from '../lib/uz';
import { UzPhoneInput } from '../components/UzPhoneInput';
import { CarriedOverNote } from '../components/ShiftCheck';
import { TZ } from '../lib/tashkent';
import { safeHref } from '../lib/safeHref';

/** Asia/Tashkent is UTC+5 all year. */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

const money = (n: number) => n.toLocaleString();
/** Another seller's client has no name here — only the fact that one exists. */
function clientNameOf(order: SellerOrder, other: string): string {
  return order.client_name ?? (order.mine ? '—' : other);
}
const TABS = [
  { key: 'free', label: 'sellerBoard.tabFree' },
  { key: 'mine', label: 'sellerBoard.tabMine' },
  { key: 'busy', label: 'sellerBoard.tabBusy' },
  // Po puti is a tab of its own between Zanyat and Ertangi (owner, 09.11.2026):
  // tapping it opens the search, and the trucks that fit are shown on the
  // board the way Zanyat shows its own, big ones left, light ones right.
  { key: 'poputi', label: 'sellerBoard.tabPoputi' },
  { key: 'tomorrow', label: 'sellerBoard.tabTomorrow' },
] as const;
type SellerView = BoardView | 'map' | 'poputi';
// The map (where every lorry is now, owner 30.10.2026) is not a tab: it sits
// as a button beside the gear in the header (owner, 03.11.2026).

const DriversMap = lazy(() => import('../components/DriversMap').then((m) => ({ default: m.DriversMap })));

const WAYBILL_SOURCES = {
  shop: "Nakladnoy do'kondan",
  warehouse: 'Nakladnoy skladdan',
  supplier: 'Nakladnoy postavshikdan',
  none: 'Bez nakladnoy',
} as const;
type WaybillSource = keyof typeof WAYBILL_SOURCES;

const STATUS_STYLE: Record<string, { chip: string; border: string }> = {
  free: { chip: 'text-free bg-free-bg', border: 'border-l-free' },
  booked: { chip: 'text-booked bg-booked-bg', border: 'border-l-booked' },
  full: { chip: 'text-full bg-full-bg', border: 'border-l-full' },
  offduty: { chip: 'text-slate-light bg-panel2', border: 'border-l-hairline' },
};

// Seven-colour vehicle-card accent (left border + legend dot). Order matches
// VEHICLE_CARD_STATES; used as an inline border colour so no Tailwind config change.
const CARD_STATE_COLOR: Record<string, string> = {
  available_idle: '#86efac', // muted green
  available_working: '#16a34a', // bright green
  // Zanyat or bron, one load or the whole lorry: one yellow.
  one_load: '#facc15',
  multi_load: '#facc15',
  full: '#facc15',
  excused: '#000000', // black
  blocked: '#dc2626', // red
};
/** A truck two or more sellers have work on. */
const SHARED_COLOR = '#ea580c';
function limitText(v: BoardVehicle): string {
  const dims =
    v.length_cm && v.width_cm && v.height_cm
      ? `, ${v.length_cm}×${v.width_cm}×${v.height_cm} sm`
      : '';
  return `${v.capacity_kg ?? '—'} kg${dims}`;
}

/** mm:ss remaining until an ISO deadline; expired + critical (<60s) flags. */
function useCountdown(deadlineIso: string | null): {
  label: string;
  expired: boolean;
  critical: boolean;
} {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadlineIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadlineIso]);
  if (!deadlineIso) return { label: '', expired: false, critical: false };
  const remaining = Math.max(0, Math.floor((new Date(deadlineIso).getTime() - now) / 1000));
  const m = Math.floor(remaining / 60);
  const s = String(remaining % 60).padStart(2, '0');
  return { label: `${m}:${s}`, expired: remaining === 0, critical: remaining <= 60 };
}

/**
 * The driver's break on his card (owner, 12.11.2026): the time left, counting
 * down; once its end has passed and he is not back, the lateness in red,
 * counting up with a minus.
 */
function BreakLine({ until, from }: { until: string; from?: string | null }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.round((new Date(until).getTime() - now) / 1000);
  const a = Math.abs(left);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = String(a % 60).padStart(2, '0');
  const clock = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  // How long it was set for: "1 soat", "1 soat 30 daq", "40 daq".
  const setMin = from ? Math.round((new Date(until).getTime() - new Date(from).getTime()) / 60_000) : 0;
  const length =
    setMin > 0
      ? [Math.floor(setMin / 60) ? t('sellerBoard.breakHours', { n: Math.floor(setMin / 60) }) : '', setMin % 60 ? t('sellerBoard.breakMins', { n: setMin % 60 }) : '']
          .filter(Boolean)
          .join(' ')
      : '';
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  return (
    <div className={`mt-1 text-xs font-bold ${left > 0 ? 'text-booked' : 'text-[#f87171]'}`}>
      <div>
        ☕ {t('sellerBoard.onBreak')}
        {length ? ` · ${length}` : ''}
        {from ? ` (${hhmm(from)}–${hhmm(until)})` : ''}
      </div>
      <div>
        {left > 0 ? t('sellerBoard.breakLeft') : t('sellerBoard.breakLate')}{' '}
        <span className="ml-1 font-mono tabular-nums">{left > 0 ? clock : `−${clock}`}</span>
      </div>
    </div>
  );
}

/**
 * "Ishxona ishi bilan" on the card (owner, 12.11.2026): what for, the time
 * left; the office can end it early. Sellers may still book the lorry.
 */
function CompanyJobLine({ job }: { job: NonNullable<BoardVehicle['company_job']> }) {
  const { user } = useAuth();
  const staff = user?.role === 'admin' || user?.role === 'manager';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const endM = useMutation({
    mutationFn: () => api.del(`/seller/company-jobs/${job.id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['seller-board'] }),
  });
  const left = Math.max(0, Math.round((new Date(job.until).getTime() - now) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = String(left % 60).padStart(2, '0');
  const clock = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  return (
    <div className="mt-1 text-xs font-bold text-[#60a5fa]">
      <div>🏢 Ishxona ishi bilan: {job.tasks.join('; ')}</div>
      <div>
        Qaytishiga: <span className="ml-1 font-mono tabular-nums">{clock}</span>
        {staff && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              if (!endM.isPending) endM.mutate();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                endM.mutate();
              }
            }}
            className="ml-3 cursor-pointer rounded border border-[#60a5fa]/50 px-1.5 py-0.5 hover:bg-[#60a5fa]/10"
          >
            Tugatish
          </span>
        )}
      </div>
    </div>
  );
}

export function SellerBoardPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [view, setView] = useState<SellerView>('free');
  const [mapSeen, setMapSeen] = useState(false);
  useEffect(() => {
    if (view === 'map') setMapSeen(true);
  }, [view]);
  /** Why the last tap did nothing, when it could not do anything. */
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<SellerTheme>(() => (embedded ? getAppliedTheme() : getSellerTheme()));
  // Inside the console the board follows the console's own light/dark switch
  // — it has no switch of its own there (owner, 05.11.2026).
  useEffect(() => {
    if (!embedded) return;
    const watch = new MutationObserver(() => setTheme(getAppliedTheme()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => watch.disconnect();
  }, [embedded]);
  const [databaseOpen, setDatabaseOpen] = useState(false);
  const [poputiOpen, setPoputiOpen] = useState(false);
  /** The last po puti search, shown on the Po puti tab. */
  const [poputiResult, setPoputiResult] = useState<PoputiSearchResult | null>(null);
  const [poputiPrefill, setPoputiPrefill] = useState<Prefill | null>(null);
  // Coming back to the tab shows the last search again, asked afresh with the
  // same cargo — not an empty form (owner, 09.11.2026).
  const rerunPoputi = (p: Prefill) => {
    void api
      .post<PoputiSearchResult>('/seller/poputi/search', {
        client_id: p.clientId,
        pickup_place_ids: p.pickupPlaceIds,
        weight_kg: p.weight.trim() ? Number(p.weight) : null,
        length_cm: p.length?.trim() ? Number(p.length) : null,
      })
      .then(setPoputiResult)
      .catch(() => undefined);
  };
  const [prefill, setPrefill] = useState<Prefill | undefined>(undefined);
  const [reserveVehicle, setReserveVehicle] = useState<BoardVehicle | null>(null);
  const [queueVehicle, setQueueVehicle] = useState<BoardVehicle | null>(null);
  const [session, setSession] = useState<{ session: BookingSession; vehicle: BoardVehicle } | null>(
    null,
  );

  const boardQ = useQuery({
    queryKey: ['seller-board', view],
    queryFn: () => api.get<BoardResponse>(`/seller/board?view=${view}`),
    enabled: view !== 'map' && view !== 'poputi',
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['seller-board'] });

  // On the tomorrow tab every tap pre-books for tomorrow; otherwise free→reserve, booked→queue.
  const openVehicle = (v: BoardVehicle) => {
    setNotice(null);
    // An off-shift lorry takes bookings like any other. The driver opens his
    // shift when he arrives and the work is already waiting for him; refusing
    // it only sent the seller to find another truck for a job this one will do.
    // The warning is on the card and in the booking window, where he decides.
    if (v.on_leave) {
      setNotice(t('sellerBoard.onLeaveNotice', { driver: v.driver_name ?? '' }));
      return;
    }
    // His own seven-minute hold is still running on this lorry: show it, with
    // the clock and the way back into the form, not a fresh Zanyat choice.
    if (v.has_my_pending_hold) {
      setQueueVehicle(v);
      return;
    }
    // An off-shift lorry with work on it already is a busy lorry: its queue
    // opens, with the Bron buttons for adding to it, like any other.
    const loaded = v.confirmed_slots > 0 || v.has_pending_hold;
    if (view === 'tomorrow' || v.board_status === 'free' || (v.board_status === 'offduty' && !loaded)) {
      setReserveVehicle(v);
    } else {
      setQueueVehicle(v);
    }
  };

  return (
    // The theme sits on a wrapper, not on the painted element: every light
    // rule is written as "inside .seller-light", and a class on the same node
    // as bg-night/text-paper is not inside anything — which is how the board
    // came out with white lettering on white cards.
    <div className={theme === 'light' ? 'seller-light' : undefined}>
    <div className="seller-shell min-h-screen bg-night text-paper">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-5">
        {/* shell — inside the admin console too, with its bell, map and settings
            (owner, 05.11.2026); the console already shows the logo. */}
        <header className="flex items-center justify-between rounded-2xl border border-hairline bg-panel px-6 py-4">
          <div>
            {embedded ? (
              // "Admin Ali" / "Dispetcher …" — who is working the board (owner, 05.11.2026).
              <div className="text-lg font-bold text-paper">
                {user?.role === 'manager' ? 'Dispetcher' : 'Admin'} {user?.name ?? ''}
              </div>
            ) : (
              <>
                <img src={logo} alt="BIGANT" className="logo logo-light h-12 w-auto" />
                <img src={logoDark} alt="BIGANT" className="logo logo-dark h-12 w-auto" />
                <div className="mt-0.5 text-sm font-semibold text-slate-light">
                  {t('sellerBoard.seller')} {user?.name ?? ''}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Inside the console its own bell and settings are already above:
                only what the console lacks stays here — the documents and the
                map (owner, 05.11.2026). */}
            {embedded ? (
              <button
                type="button"
                onClick={() => setDatabaseOpen(true)}
                className="flex h-10 items-center gap-2 rounded-lg border border-hairline bg-panel2 px-3 text-sm font-bold text-paper hover:bg-[#28303d]"
              >
                {t('sellerBoard.database')}
              </button>
            ) : (
              <SellerBell />
            )}
            <button
              type="button"
              onClick={() => setView(view === 'map' ? 'free' : 'map')}
              aria-pressed={view === 'map'}
              aria-label={t('sellerBoard.tabMap')}
              title={t('sellerBoard.tabMap')}
              className={`flex h-10 items-center gap-2 rounded-lg border border-hairline px-3 text-sm font-bold hover:bg-[#28303d] ${
                view === 'map' ? 'seller-pill-on' : 'bg-panel2 text-paper'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z" />
                <path d="M9 3v15M15 6v15" />
              </svg>
              {t('sellerBoard.tabMap')}
            </button>
            {!embedded && (
              <SettingsMenu
                theme={theme}
                onTheme={(next) => {
                  setSellerTheme(next);
                  setTheme(next);
                }}
                onLogout={logout}
              />
            )}
          </div>
        </header>
        {databaseOpen && <DatabaseModal onClose={() => setDatabaseOpen(false)} />}

        {/* tabs */}
        <div className="my-5 grid grid-cols-2 gap-1.5 rounded-2xl border border-hairline bg-panel p-1.5 sm:grid-cols-5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setView(tab.key);
                // The tab opens as a tab (owner, 12.11.2026): the search form
                // only from its "Po puti topish" button, not over the page at once.
                if (tab.key === 'poputi' && poputiPrefill) rerunPoputi(poputiPrefill);
              }}
              className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                view === tab.key
                  ? 'seller-pill-on'
                  : 'text-slate-light hover:bg-[#1c2431] hover:text-paper'
              }`}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>


        {notice && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-paper">
            <span>{notice}</span>
            <button type="button" className="shrink-0 font-bold text-brand" onClick={() => setNotice(null)}>
              ✕
            </button>
          </div>
        )}

        {/* Once opened the map stays alive behind the other tabs: Google bills
            each map it creates, and coming back to the tab should not be one. */}
        {mapSeen && (
          <div hidden={view !== 'map'}>
            <Suspense fallback={<p className="py-16 text-center text-slate-light">{t('common.loading')}</p>}>
              <DriversMap />
            </Suspense>
          </div>
        )}
        {/* Po puti opens straight on its form, inside the tab (owner, 12.11.2026):
            the tabs above stay clickable, nothing to close first. */}
        {view === 'poputi' && !poputiResult && (
          <PoputiSearchModal
            inline
            onClose={() => undefined}
            onFound={(res, filled) => {
              setPoputiResult(res);
              setPoputiPrefill(filled);
            }}
          />
        )}
        {view === 'poputi' && poputiResult && (
          <PoputiBoard
            result={poputiResult}
            prefill={poputiPrefill}
            onSearch={() => setPoputiOpen(true)}
            onPicked={(res, v, filled) => {
              setPrefill(filled);
              setSession({ session: res, vehicle: v });
            }}
          />
        )}
        {view === 'map' || view === 'poputi' ? null : (
          <>
        {/* No colour legend over the board (owner, 03.11.2026): the cards say their state themselves. */}

        {boardQ.isLoading ? (
          <p className="py-16 text-center text-slate-light">{t('common.loading')}</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Column
              title={t('sellerBoard.katta')}
              vehicles={boardQ.data?.katta ?? []}
              onCard={openVehicle}
              tomorrow={view === 'tomorrow'}
            />
            <Column
              title={t('sellerBoard.yengil')}
              vehicles={boardQ.data?.yengil ?? []}
              onCard={openVehicle}
              tomorrow={view === 'tomorrow'}
            />
          </div>
        )}

        {/* On his own tab the lorries above are the work still running; what
            was finished today belongs under a line of its own, not mixed in. */}
        {view === 'mine' && <MyFinishedOrders />}
          </>
        )}
      </div>

      {reserveVehicle && (
        <ReserveModal
          vehicle={reserveVehicle}
          tomorrow={view === 'tomorrow'}
          onClose={() => setReserveVehicle(null)}
          onCompanyJob={() => {
            setReserveVehicle(null);
            void refresh();
          }}
          onReserved={(res, v) => {
            setReserveVehicle(null);
            setSession({ session: res, vehicle: v });
            void refresh();
          }}
        />
      )}
      {queueVehicle && (
        <QueueModal
          vehicle={queueVehicle}
          onlyMine={view === 'mine'}
          onClose={() => setQueueVehicle(null)}
          onOpenSession={(s) => {
            const v = queueVehicle;
            setQueueVehicle(null);
            setSession({ session: s, vehicle: v });
          }}
          onChanged={refresh}
        />
      )}
      {poputiOpen && (
        <PoputiSearchModal
          onClose={() => setPoputiOpen(false)}
          onFound={(res, filled) => {
            setPoputiResult(res);
            setPoputiPrefill(filled);
            setPoputiOpen(false);
            setView('poputi');
          }}
        />
      )}
      {session && (
        <FillSession
          initial={session.session}
          vehicle={session.vehicle}
          prefill={prefill}
          onClose={(expired, saved) => {
            setSession(null);
            setPrefill(undefined);
            if (expired) setNotice(t('errors.reservation_expired'));
            if (saved) {
              setView('mine');
              // Booked: that search is done with.
              setPoputiResult(null);
              setPoputiPrefill(null);
            }
            void refresh();
          }}
        />
      )}
    </div>
    </div>
  );
}

const loadedOf = (v: BoardVehicle) => v.confirmed_slots > 0 || v.has_pending_hold;

function Column({
  title,
  vehicles,
  onCard,
  tomorrow,
}: {
  title: string;
  vehicles: BoardVehicle[];
  onCard: (v: BoardVehicle) => void;
  tomorrow?: boolean;
}) {
  const { t } = useTranslation();
  const active = vehicles.filter((v) => v.on_leave || v.board_status !== 'offduty');
  const offduty = vehicles.filter((v) => !v.on_leave && v.board_status === 'offduty');
  return (
    <div>
      <div className="mb-2.5 rounded-lg border border-hairline bg-panel2 px-3.5 py-2.5 text-sm font-bold tracking-wide text-slate-light">
        {title} • <span className="text-paper">{vehicles.length}</span>
      </div>
      {active.length > 0 && offduty.length > 0 && (
        <div className="mb-1 px-0.5 text-[11px] uppercase tracking-widest text-slate">
          ✓ {t('sellerBoard.onShift')} • {active.length}
        </div>
      )}
      {tomorrow ? (
        // Ertangi: free on top, booked under a line, on leave under another.
        [
          { key: 'free', list: active.filter((v) => !v.on_leave && !loadedOf(v)) },
          { key: 'bron', list: active.filter((v) => !v.on_leave && loadedOf(v)) },
          { key: 'leave', list: active.filter((v) => v.on_leave) },
        ]
          .filter((g) => g.list.length > 0)
          .map((g, i) => (
            <div key={g.key}>
              {i > 0 && (
                <div className="mb-1 mt-3.5 border-t-2 border-hairline px-0.5 pt-3 text-[11px] uppercase tracking-widest text-slate">
                  {g.key === 'bron' ? t('sellerBoard.groupBron') : t('sellerBoard.groupLeave')} • {g.list.length}
                </div>
              )}
              <div className="flex flex-col gap-2.5">
                {g.list.map((v) => (
                  <VehicleCard key={v.id} v={v} tomorrow={tomorrow} onClick={() => onCard(v)} />
                ))}
              </div>
            </div>
          ))
      ) : (
        <div className="flex flex-col gap-2.5">
          {active.map((v) => (
            <VehicleCard key={v.id} v={v} tomorrow={tomorrow} onClick={() => onCard(v)} />
          ))}
        </div>
      )}
      {offduty.length > 0 && (
        <>
          {/* A line, not just a gap, between the ones on shift and the rest. */}
          <div className="mb-1 mt-3.5 border-t-2 border-hairline px-0.5 pt-3 text-[11px] uppercase tracking-widest text-slate">
            ⛔ {t('sellerBoard.offduty')} • {offduty.length}
          </div>
          <div className="flex flex-col gap-2.5">
            {/* Off shift is a note on the card, not a locked door: the booking
                waits for him until he presses Ish boshlandi. */}
            {offduty.map((v) => (
              <VehicleCard key={v.id} v={v} tomorrow={tomorrow} onClick={() => onCard(v)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}


/** 2026-10-27 → 27.10 */
function dm(ymd: string | null): string {
  return ymd ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : '—';
}

function VehicleCard({ v, onClick, tomorrow }: { v: BoardVehicle; onClick: () => void; tomorrow?: boolean }) {
  const { t } = useTranslation();
  // Ertangi is booked, not taken: "1x bron", "Polniy bron".
  const bookedKey = tomorrow ? 'sellerBoard.statusBron' : 'sellerBoard.statusBooked';
  const fullKey = tomorrow ? 'sellerBoard.statusBronFull' : 'sellerBoard.statusFull';
  const st = STATUS_STYLE[v.board_status];
  // One seller's work on the truck: yellow. A second seller on it as well:
  // dark orange (owner, 09.11.2026). Free stays green, blocked red.
  const loadedState = v.card_state === 'one_load' || v.card_state === 'multi_load' || v.card_state === 'full';
  const cardColor = loadedState && v.seller_count >= 2 ? SHARED_COLOR : CARD_STATE_COLOR[v.card_state];
  const timer = useCountdown(v.awaiting_until);
  // On leave, or "Polniy" today: shown, but nothing to book.
  const clickable = !v.on_leave && !v.day_off;
  const pendingOnly = v.confirmed_slots === 0 && v.has_pending_hold;
  // What is on the lorry comes first; whether its driver has clocked in is
  // said on its own line. An off-shift truck with two orders on it is a
  // booked truck, and reading "Ishdan ketdi" over them helped nobody.
  // A return is not a zanyat: the chip names it, alone or beside the deliveries.
  const deliveries = v.confirmed_slots - v.vozvrat_slots;
  const chipLabel = v.on_leave
    ? t('sellerBoard.statusOnLeave')
    : v.confirmed_full_booking
    ? t(fullKey)
    : v.vozvrat_slots > 0 && deliveries === 0
      ? t('sellerBoard.statusVozvrat', { n: v.vozvrat_slots })
      : v.vozvrat_slots > 0
        ? `${t(bookedKey, { n: deliveries })} + ${t('sellerBoard.statusVozvrat', { n: v.vozvrat_slots })}`
    : v.board_status === 'full' && v.has_pending_hold
      ? t(fullKey)
    : v.confirmed_slots + v.pending_holds > 0
      // Saved orders plus one still being filled: counted, clock beside.
      ? t(bookedKey, { n: v.confirmed_slots + v.pending_holds })
        // Not started yet and nothing on it: still a free truck, said in green
        // beside "Hali ishni boshlamagan" (owner, 09.11.2026).
        : t('sellerBoard.statusFree');
  const offdutyFree = !v.on_leave && v.board_status === 'offduty' && v.confirmed_slots + v.pending_holds === 0 && !v.has_pending_hold;
  const chipClock =
    v.has_pending_hold && v.board_status !== 'full' && v.awaiting_until && !timer.expired ? timer.label : null;
  // A red card is the one thing on this board a seller cannot act on, and the
  // dot alone left him guessing. Name it: at the repair shop, or papers out of
  // date — and which papers, because that is a different wait.
  const blocked =
    v.blocked_reason === 'repair'
      ? t('sellerBoard.blockedRepair')
      : v.blocked_reason === 'inactive'
        ? t('sellerBoard.blockedInactive')
        : v.blocked_reason === 'license_expired'
          ? t('sellerBoard.blockedLicense')
        : v.blocked_reason === 'documents'
          ? t('sellerBoard.blockedDocs', {
              docs: v.expired_docs.map((d) => t(`vehicleDocType.${d}`)).join(', '),
            })
        : v.blocked_reason === 'missing_documents'
          ? t('sellerBoard.blockedMissingDocs', {
              docs: v.missing_docs.map((d) => t(`vehicleDocType.${d}`)).join(', '),
            })
          : v.blocked_reason === 'incomplete'
            ? t('sellerBoard.blockedIncomplete', {
                fields: v.missing_fields.map((f) => t(`vehicleField.${f}`)).join(', '),
              })
            : null;
  // He is there: the line says so, in green, and nothing is added under it.
  const arrived = v.order_status === 'arrived_at_customer';
  // Place-aware Vozrat status for a carried return.
  const returnPlace = v.return_destination ? t(`sellerBoard.retDest_${v.return_destination}`) : '';
  const returnLabel =
    v.return_stage === 'arrived'
      ? t('sellerBoard.returnArrivedAt', { place: returnPlace })
      : v.return_stage === 'heading'
        ? t('sellerBoard.returnHeadingTo', { place: returnPlace })
        : t('sellerBoard.hasPendingReturn');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      style={{ borderLeftColor: cardColor }}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border border-hairline border-l-4 bg-panel px-4 py-3 text-left transition ${st.border} ${
        clickable ? 'hover:bg-[#1a212c]' : 'cursor-default opacity-75'
      }`}
    >
      <div>
        <div className="flex items-center gap-2 text-[15px] font-bold">
          <span
            className={`inline-block h-2.5 w-2.5 flex-none rounded-full ${v.card_state === 'excused' ? 'ring-1 ring-slate-light' : ''}`}
            style={{ backgroundColor: cardColor }}
            title={blocked ?? t(`sellerBoard.cardState.${v.card_state}`)}
          />
          {v.model}{' '}
          <span className="font-mono text-sm font-semibold text-slate-light">
            · {v.plate_number}
          </span>
        </div>
        <div className={`mt-0.5 text-xs ${arrived ? 'font-semibold text-free' : 'text-slate-light'}`}>
          {v.driver_name ?? '—'}
          {v.order_status ? (
            <>
              {' · '}
              <span className={arrived ? '' : 'font-semibold text-paper'}>
                {t(`orderStatus.${v.order_status}`)}
              </span>
            </>
          ) : null}
        </div>
        {/* Only for the order the driver is actually on, and only if it is ours —
            a queued order's ETA would be an "if he left now" number. And once
            he is standing at the client, "a minute away, 0.0 km" is noise under
            a line that already says he has arrived. */}
        {!arrived && v.current_order_id && v.my_order_ids.includes(v.current_order_id) && (
          <SellerEta
            orderId={v.current_order_id}
            className="mt-1"
            tone={v.order_status === 'on_the_way' ? 'moving' : 'waiting'}
          />
        )}
        {blocked && (
          <div className="mt-1 text-xs font-bold text-[#f87171]">● {blocked}</div>
        )}
        {/* The form still being filled: its own line, under the papers. */}
        {chipClock && (
          <div className={`mt-1 text-xs font-bold ${timer.critical ? 'text-full' : 'text-booked'}`}>
            ⏳ {t('sellerBoard.awaitingInfo')} <span className="ml-1 font-mono tabular-nums">{chipClock}</span>
          </div>
        )}
        {v.break_until && !tomorrow && <BreakLine until={v.break_until} from={v.break_from} />}
        {v.company_job && !tomorrow && <CompanyJobLine job={v.company_job} />}
        {v.on_leave ? (
          <div className="mt-1 text-xs font-bold text-slate-light">
            {t('sellerBoard.onLeaveDates', { from: dm(v.leave_from), to: dm(v.leave_to) })}
          </div>
        ) : v.day_off ? (
          <div className="mt-1 text-xs font-bold text-slate-light">{t('sellerBoard.dayOff')}</div>
        ) : v.board_status === 'offduty' || (tomorrow && v.driver_not_started) ? (
          <div className="mt-1 text-xs font-bold text-booked">⏱ {t('sellerBoard.notStartedYet')}</div>
        ) : null}
        {v.has_pending_return && (
          <div className="mt-1 text-xs font-bold text-[#f87171]">↩ {returnLabel}</div>
        )}
      </div>
      <div className="flex flex-none items-center gap-2">
        {v.poputi_open && (
          <span
            title={t('sellerBoard.poputiOpenHint')}
            className="rounded-full border border-free/50 bg-free-bg px-2 py-0.5 text-[10px] font-bold text-free"
          >
            {t('sellerBoard.poputi')}
          </span>
        )}
        {v.has_pending_return && (
          <span
            title={returnLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-[#b91c1c] text-[13px] font-black text-white"
          >
            !
          </span>
        )}
        {(v.on_leave || v.board_status !== 'offduty' || v.confirmed_slots > 0 || v.has_pending_hold || offdutyFree) && (
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
              offdutyFree ? STATUS_STYLE.free.chip : pendingOnly ? STATUS_STYLE.booked.chip : st.chip
            }`}
          >
            {chipLabel}
          </span>
        )}
      </div>
    </button>
  );
}

// --- Reserve modal (free truck today, or pre-book for tomorrow) ---
/** What the seller typed into the search, carried into the fill form. */
interface Prefill {
  clientId: string;
  pickupPlaceIds: string[];
  weight: string;
  /** Po puti: the order on the truck the seller picked it to ride with. */
  hostOrderId?: string | null;
  /** Po puti: the longest piece, cm, as searched. */
  length?: string;
}

/**
 * Po puti, asked the other way round: describe the cargo, and the board answers
 * which trucks can carry it.
 *
 * Choosing a truck first means holding it for seven minutes and filling a whole
 * form before the fences get a say. Here nothing is reserved until a truck has
 * already said yes, so a search that finds nothing costs the seller nothing.
 */
function PoputiSearchModal({
  onClose,
  onFound,
  inline = false,
}: {
  onClose: () => void;
  onFound: (result: PoputiSearchResult, prefill: Prefill) => void;
  /** Inside the Po puti tab, not over the page: the other tabs stay a click away (owner, 12.11.2026). */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState('');
  const [sources, setSources] = useState<string[]>(['']);
  const [weight, setWeight] = useState('');
  // The longest piece (pipe, rebar, profile), optional (owner, 10.11.2026).
  const [length, setLength] = useState('');
  const lengthNum = Number(length);
  const lengthOk = length.trim() === '' || (Number.isInteger(lengthNum) && lengthNum > 0);

  const placesQ = useQuery({
    queryKey: ['pickup-places'],
    queryFn: () => api.get<PickupPlacePublic[]>('/pickup-places'),
  });
  const chosen = sources.filter(Boolean);
  const weightNum = Number(weight);
  const weightOk = weight.trim() !== '' && Number.isInteger(weightNum) && weightNum > 0;
  // Weight is required here (owner, 10.11.2026).
  const ready = clientId !== '' && chosen.length > 0 && weightOk && lengthOk;

  // The window closes on an answer and the Po puti tab shows it (owner, 09.11.2026).
  const searchM = useMutation({
    mutationFn: () =>
      api.post<PoputiSearchResult>('/seller/poputi/search', {
        client_id: clientId,
        pickup_place_ids: chosen,
        weight_kg: weightNum,
        length_cm: length.trim() ? lengthNum : null,
      }),
    onSuccess: (res) => onFound(res, { clientId, pickupPlaceIds: chosen, weight, length }),
  });

  return (
    inline ? (
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-hairline bg-panel p-5 text-paper">
        <h2 className="mb-4 font-display text-lg font-extrabold">{t('sellerBoard.poputiFind')}</h2>
      <div className="flex flex-col gap-3.5">
        <Labeled label={t('sellerBoard.client')}>
          <ClientPicker
            id="ps-client"
            value={clientId}
            onSelect={setClientId}
            onCreated={(c) => setClientId(c.id)}
          />
        </Labeled>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-widest text-slate-light">
            {t('sellerBoard.sources')}
          </span>
          {sources.map((value, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <PickupPlacePicker
                  value={value}
                  places={placesQ.data ?? []}
                  onSelect={(id) => setSources((cur) => cur.map((v, j) => (j === i ? id : v)))}
                />
              </div>
              {sources.length > 1 && (
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() => setSources((cur) => cur.filter((_, j) => j !== i))}
                  className="rounded-lg border border-hairline px-3 py-2 text-sm font-semibold text-slate-light hover:text-full"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
          {sources.length < 10 && (
            <button
              type="button"
              onClick={() => setSources((cur) => [...cur, ''])}
              className="self-start text-sm font-semibold text-brand hover:underline"
            >
              + {t('sellerBoard.addPickup')}
            </button>
          )}
        </div>

        <Labeled label={t('sellerBoard.weight')}>
          <Input id="ps-weight" value={weight} onChange={setWeight} placeholder="640" />
        </Labeled>

        <Labeled label={t('sellerBoard.poputiLength')}>
          <Input id="ps-length" value={length} onChange={setLength} placeholder="600" />
        </Labeled>

        {searchM.isError && <ErrorLine msg={t('sellerBoard.errPoputiSearch')} />}

        <ActionBtn
          kind="brand"
          onClick={() => searchM.mutate()}
          disabled={!ready || searchM.isPending}
        >
          {searchM.isPending ? t('common.loading') : t('sellerBoard.poputiSearchGo')}
        </ActionBtn>
      </div>
      </div>
    ) : (
    <ModalShell title={t('sellerBoard.poputiFind')} onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <Labeled label={t('sellerBoard.client')}>
          <ClientPicker
            id="ps-client"
            value={clientId}
            onSelect={setClientId}
            onCreated={(c) => setClientId(c.id)}
          />
        </Labeled>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-widest text-slate-light">
            {t('sellerBoard.sources')}
          </span>
          {sources.map((value, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <PickupPlacePicker
                  value={value}
                  places={placesQ.data ?? []}
                  onSelect={(id) => setSources((cur) => cur.map((v, j) => (j === i ? id : v)))}
                />
              </div>
              {sources.length > 1 && (
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() => setSources((cur) => cur.filter((_, j) => j !== i))}
                  className="rounded-lg border border-hairline px-3 py-2 text-sm font-semibold text-slate-light hover:text-full"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
          {sources.length < 10 && (
            <button
              type="button"
              onClick={() => setSources((cur) => [...cur, ''])}
              className="self-start text-sm font-semibold text-brand hover:underline"
            >
              + {t('sellerBoard.addPickup')}
            </button>
          )}
        </div>

        <Labeled label={t('sellerBoard.weight')}>
          <Input id="ps-weight" value={weight} onChange={setWeight} placeholder="640" />
        </Labeled>

        <Labeled label={t('sellerBoard.poputiLength')}>
          <Input id="ps-length" value={length} onChange={setLength} placeholder="600" />
        </Labeled>

        {searchM.isError && <ErrorLine msg={t('sellerBoard.errPoputiSearch')} />}

        <ActionBtn
          kind="brand"
          onClick={() => searchM.mutate()}
          disabled={!ready || searchM.isPending}
        >
          {searchM.isPending ? t('common.loading') : t('sellerBoard.poputiSearchGo')}
        </ActionBtn>
      </div>
    </ModalShell>
    )
  );
}

/** Katta (Gazels, Isuzu) or yengil (Damas, Labo, Cobalt), as the board splits them. */
const isKatta = (category: string) => category === 'katta' || category === 'orta';

/**
 * The Po puti tab: the trucks the last search found, on the board the way
 * Zanyat shows its own (owner, 09.11.2026). Tapping one holds it and opens the
 * form already filled with what was searched; the rules are checked again then.
 */
function PoputiBoard({
  result,
  prefill,
  onSearch,
  onPicked,
}: {
  result: PoputiSearchResult | null;
  prefill: Prefill | null;
  onSearch: () => void;
  onPicked: (session: ReserveResult, vehicle: BoardVehicle, prefill: Prefill) => void;
}) {
  const { t } = useTranslation();

  const pickM = useMutation({
    mutationFn: async ({ vehicleId, hostOrderId }: { vehicleId: string; hostOrderId: string | null }) => {
      // The trip the card showed is the one it rides with (owner, 10.11.2026).
      const session = await api.post<ReserveResult>(
        `/seller/vehicles/${vehicleId}/poputi`,
        hostOrderId ? { host_order_id: hostOrderId } : {},
      );
      // The form needs the truck as the board knows it: it rides on today's
      // work, or on a later day's (Ertangi).
      for (const view of ['busy', 'tomorrow', 'free'] as const) {
        const board = await api.get<BoardResponse>(`/seller/board?view=${view}`);
        const v = [...board.katta, ...board.yengil].find((x) => x.id === vehicleId);
        if (v) return { session, v, hostOrderId };
      }
      throw new Error('vehicle_not_on_board');
    },
    onSuccess: ({ session, v, hostOrderId }) => {
      if (prefill) onPicked(session, v, { ...prefill, hostOrderId });
    },
  });

  if (!result) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-slate-light">
        <p>{t('sellerBoard.poputiEmptyHint')}</p>
        <button
          type="button"
          onClick={onSearch}
          className="rounded-xl border border-brand bg-brand/10 px-4 py-2.5 text-sm font-bold text-brand hover:bg-brand/20"
        >
          {t('sellerBoard.poputiFind')}
        </button>
      </div>
    );
  }

  const katta = result.matches.filter((m) => isKatta(m.category));
  const yengil = result.matches.filter((m) => !isKatta(m.category));
  // A po puti truck is never free: it already carries work. Coloured the way
  // the board colours it (owner, 09.11.2026): zanyat yellow, bron dark orange,
  // each group under a line naming it.
  const ZANYAT = '#facc15';
  const BRON = '#ea580c';
  // Bigger than a board card (owner, 09.11.2026): here it is the answer.
  const card = (m: PoputiSearchResult['matches'][number]) => {
    const color = m.later_day ? BRON : ZANYAT;
    return (
      <button
        key={m.vehicle_id}
        type="button"
        onClick={() => pickM.mutate({ vehicleId: m.vehicle_id, hostOrderId: m.host_order_id ?? null })}
        disabled={pickM.isPending}
        style={{ borderLeftColor: color }}
        className="block w-full rounded-2xl border border-hairline border-l-[6px] bg-panel px-5 py-5 text-left transition hover:bg-[#1a212c] disabled:opacity-60"
      >
        <div>
          {/* Model and plate on one line, never broken (owner, 10.11.2026). */}
          <div className="flex items-center gap-2.5 whitespace-nowrap text-lg font-bold">
            <span className="inline-block h-3 w-3 flex-none rounded-full" style={{ backgroundColor: color }} />
            <span>{m.model}</span>
            <span className="font-mono text-base font-semibold text-slate-light">· {m.plate_number}</span>
          </div>
          <div className="mt-1.5 text-sm text-slate-light">
            {/* Which of the truck's orders it rides with: the one now, or one waiting its turn. */}
            {/* Read at a glance: goes now, or after the orders ahead of it (owner, 10.11.2026). */}
            {(m.reys ?? 1) <= 1 ? (
              <span className="font-bold text-free">{t('sellerBoard.poputiReysNow')}</span>
            ) : (
              <span className="font-bold" style={{ color: BRON }}>
                {t('sellerBoard.poputiReysLater', { n: m.reys, k: (m.reys ?? 2) - 1 })}
              </span>
            )}
            {' · '}
            {m.driver_name ?? '—'}
          </div>
          {/* When the seller's cargo is collected: after the orders ahead (owner, 10.11.2026). */}
          {m.pickup_eta && (
            <div className="mt-1.5 text-base font-bold text-paper">
              {t('sellerBoard.poputiPickupEta', {
                time: new Date(m.pickup_eta).toLocaleTimeString('uz-UZ', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                  timeZone: 'Asia/Tashkent',
                }),
              })}
            </div>
          )}
          {/* Where it is going, on a line of its own, unbroken (owner, 10.11.2026). */}
          {m.heading_to && (
            <div className="mt-1 whitespace-nowrap text-sm text-slate-light">
              {t('sellerBoard.poputiHeading', { place: m.heading_to })}
            </div>
          )}
          {/* The chips sit on this line, inside the card (owner, 10.11.2026). */}
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-slate-light">
              {m.detour_km != null
                ? t('sellerBoard.poputiDetour', {
                    km: m.detour_km.toFixed(1),
                    min: Math.round((m.detour_seconds ?? 0) / 60),
                  })
                : t('sellerBoard.poputiDetourUnknown')}
            </span>
            <span className="flex flex-none items-center gap-2">
              <span className="rounded-full border border-free/50 bg-free-bg px-2.5 py-1 text-xs font-bold text-free">
                {t('sellerBoard.poputi')}
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-sm font-bold"
                style={{ color, backgroundColor: `${color}26` }}
              >
                {m.later_day ? t('sellerBoard.groupBron') : t('sellerBoard.zanyatShort')}
              </span>
            </span>
          </div>
          {m.later_day && (
            <div className="mt-1.5 text-sm font-bold" style={{ color: BRON }}>
              {t('sellerBoard.poputiLaterDay', {
                date: `${m.later_day.slice(8, 10)}.${m.later_day.slice(5, 7)}`,
              })}
            </div>
          )}
        </div>
      </button>
    );
  };
  const column = (title: string, list: PoputiSearchResult['matches']) => {
    const groups = [
      { key: 'zanyat', label: t('sellerBoard.tabBusy'), list: list.filter((m) => !m.later_day) },
      { key: 'bron', label: t('sellerBoard.groupBron'), list: list.filter((m) => !!m.later_day) },
    ].filter((g) => g.list.length > 0);
    return (
      <div>
        <div className="mb-2.5 rounded-lg border border-hairline bg-panel2 px-3.5 py-2.5 text-sm font-bold tracking-wide text-slate-light">
          {title} • <span className="text-paper">{list.length}</span>
        </div>
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-1 mt-3.5 border-t-2 border-hairline px-0.5 pt-3 text-[11px] uppercase tracking-widest text-slate">
              {g.label} • {g.list.length}
            </div>
            <div className="flex flex-col gap-2.5">{g.list.map(card)}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSearch}
          className="rounded-xl border border-brand bg-brand/10 px-4 py-2.5 text-sm font-bold text-brand hover:bg-brand/20"
        >
          {t('sellerBoard.poputiNewSearch')}
        </button>
      </div>
      {pickM.isError && <ErrorLine msg={t('sellerBoard.errPoputi')} />}
      {result.matches.length === 0 && (
        // Big and bright, so a seller cannot miss that nothing fits (owner, 10.11.2026).
        <div className="rounded-2xl border-2 border-brand bg-brand/15 px-6 py-8 text-center text-xl font-extrabold text-brand">
          {t('sellerBoard.poputiNone')}
        </div>
      )}
      {result.matches.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {column(t('sellerBoard.katta'), katta)}
          {column(t('sellerBoard.yengil'), yengil)}
        </div>
      )}
      {/* Only the trucks that fit: no "4.2 km, the limit is 4" lines (owner, 09.11.2026). */}
    </div>
  );
}

function ReserveModal({
  vehicle,
  tomorrow,
  onClose,
  onReserved,
  onCompanyJob,
}: {
  vehicle: BoardVehicle;
  tomorrow?: boolean;
  onClose: () => void;
  onReserved: (r: ReserveResult, v: BoardVehicle) => void;
  onCompanyJob?: () => void;
}) {
  const { t } = useTranslation();
  // Admin and dispatcher in Statuslar (owner, 12.11.2026): "Ishxona ishi bilan".
  const { user } = useAuth();
  const staff = user?.role === 'admin' || user?.role === 'manager';
  const [companyJob, setCompanyJob] = useState(false);
  // Tomorrow in Tashkent (UTC+5), whatever the seller's own clock says. The UTC
  // date meant a booking made before 05:00 went onto today, not tomorrow.
  const scheduledDate = tomorrow
    ? new Date(Date.now() + TASHKENT_OFFSET_MS + 86_400_000).toISOString().slice(0, 10)
    : undefined;
  // Ertangi: when the work starts. Nothing is booked until he says which.
  const [slot, setSlot] = useState<'before' | 'after' | null>(null);
  const locked = tomorrow && slot === null;
  const m = useMutation({
    mutationFn: (mode: BookingMode) =>
      api.post<ReserveResult>(`/seller/vehicles/${vehicle.id}/reserve`, {
        kind: tomorrow ? 'bron' : 'zanyat',
        mode,
        ...(scheduledDate ? { scheduled_date: scheduledDate, start_after_nine: slot === 'after' } : {}),
      }),
    onSuccess: (r) => onReserved(r, vehicle),
  });
  const labels = tomorrow
    ? {
        single: t('sellerBoard.bron'),
        double: t('sellerBoard.bron2x'),
        full: t('sellerBoard.bronFull'),
      }
    : {
        single: t('sellerBoard.zanyat'),
        double: t('sellerBoard.zanyat2x'),
        full: t('sellerBoard.zanyatFull'),
      };
  // His own Ertangi bookings on this lorry: the time is changed here, in
  // place. Picking it again up top would start a new booking and a new form.
  const queueQ = useQuery({
    queryKey: ['seller-queue', vehicle.id],
    queryFn: () => api.get<VehicleQueue>(`/seller/vehicles/${vehicle.id}/queue`),
    enabled: !!tomorrow,
  });
  const myTomorrow = (queueQ.data?.orders ?? []).filter(
    (o) => o.mine && !o.is_vozvrat && o.actions_available_at && Date.parse(o.actions_available_at) > Date.now(),
  );
  // With a booking of his own here, a new one starts behind "Yana bron qilish".
  const [more, setMore] = useState(false);
  const showNew = !tomorrow || (!queueQ.isLoading && (myTomorrow.length === 0 || more));
  if (companyJob) {
    return (
      <ModalShell title={`🏢 ${t('sellerBoard.companyWork')} · ${vehicle.plate_number}`} onClose={onClose}>
        <CompanyJobForm vehicleId={vehicle.id} onBack={() => setCompanyJob(false)} onDone={() => (onCompanyJob ?? onClose)()} />
      </ModalShell>
    );
  }
  return (
    <ModalShell title={`${vehicle.model} · ${vehicle.plate_number}`} onClose={onClose}>
      <VehicleInfo vehicle={vehicle} status={vehicle.board_status} />
      {myTomorrow.length > 0 && (
        <div className="mb-4 rounded-xl border border-hairline bg-panel2 p-3.5">
          <div className="mb-2.5 text-sm font-bold text-paper">{t('sellerBoard.myBronTitle')}</div>
          <div className="flex flex-col gap-3">
            {myTomorrow.map((o) => (
              <MyBronTime key={o.id} order={o} vehicleId={vehicle.id} />
            ))}
          </div>
        </div>
      )}
      {tomorrow && myTomorrow.length > 0 && !more && (
        <ActionBtn kind="brand" className="w-full" onClick={() => setMore(true)}>
          {t('sellerBoard.newBronTitle')}
        </ActionBtn>
      )}
      {tomorrow && myTomorrow.length > 0 && more && (
        <div className="mb-2 text-sm font-bold text-paper">{t('sellerBoard.newBronTitle')}</div>
      )}
      {vehicle.board_status === 'offduty' && !tomorrow && (
        <div className="mb-3.5 rounded-lg border border-booked/40 bg-booked-bg px-3.5 py-2.5 text-sm font-semibold text-booked">
          ⏱ {t('sellerBoard.offdutyNotice', { driver: vehicle.driver_name ?? '' })}
        </div>
      )}
      {m.isError && (
        <ErrorLine
          msg={
            // "To'la band" only when the server said so; a dropped connection
            // or a restart is not a full lorry.
            m.error instanceof ApiError && m.error.message === 'vehicle_in_repair'
              ? t('errors.vehicle_in_repair')
              : m.error instanceof ApiError && m.error.message === 'driver_day_off'
                ? t('errors.driver_day_off')
              : m.error instanceof ApiError && m.error.message === 'vehicle_full'
                ? t('sellerBoard.errFull')
                : t('sellerBoard.errReserveRetry')
          }
        />
      )}
      {tomorrow && showNew && (
        <div className="mb-3.5">
          <StartTimeButtons value={slot} onPick={setSlot} />
        </div>
      )}
      {/* Ertangi: the two start times first, alone; the bookings once one is picked. */}
      {!locked && showNew && (
      <div className="grid grid-cols-2 gap-2.5">
        <ActionBtn kind="brand" onClick={() => m.mutate('single')} disabled={m.isPending}>
          {labels.single}
        </ActionBtn>
        <ActionBtn kind="brand2" onClick={() => m.mutate('double')} disabled={m.isPending}>
          {labels.double}
        </ActionBtn>
        <ActionBtn
          kind="neutral"
          className="col-span-2"
          onClick={() => m.mutate('full')}
          disabled={m.isPending}
        >
          {labels.full}
        </ActionBtn>
        {/* Company business, for the office only (owner, 12.11.2026): what for
            and about how long. Today's board only. */}
        {staff && !tomorrow && !vehicle.company_job && (
          <ActionBtn kind="neutral" className="col-span-2" onClick={() => setCompanyJob(true)} disabled={m.isPending}>
            🏢 {t('sellerBoard.companyWork')}
          </ActionBtn>
        )}
      </div>
      )}
      {tomorrow && !locked && showNew && (
        <div className="mt-3 rounded-lg border border-hairline bg-panel2 px-3.5 py-2.5 text-center text-sm text-slate-light">
          {t('sellerBoard.tomorrowNote')}
        </div>
      )}
    </ModalShell>
  );
}

/**
 * The gear in the header: how the board looks, what it has to tell him, and
 * the way out. One button, because three along a header is a toolbar and this
 * is a screen a seller works in all day with one lorry in mind.
 */
function SettingsMenu({
  theme,
  onTheme,
  onLogout,
}: {
  theme: SellerTheme;
  onTheme: (next: SellerTheme) => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [passports, setPassports] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('sellerBoard.settings')}
        title={t('sellerBoard.settings')}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-panel2 text-paper hover:bg-[#28303d]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-hairline bg-panel shadow-2xl">
            <div className="px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-light">
              {t('sellerBoard.mode')}
            </div>
            <div className="flex gap-1.5 px-3 pb-3">
              {(['light', 'dark'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onTheme(value)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    theme === value
                      ? 'seller-pill-on'
                      : 'bg-panel2 text-slate-light hover:text-paper'
                  }`}
                >
                  {t(value === 'light' ? 'sellerBoard.modeLight' : 'sellerBoard.modeDark')}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPassports(true);
              }}
              className="w-full border-t border-hairline px-4 py-3 text-left text-sm font-semibold text-paper hover:bg-panel2"
            >
              {t('sellerBoard.database')}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="w-full border-t border-hairline px-4 py-3 text-left text-sm font-semibold text-full hover:bg-panel2"
            >
              {t('sellerBoard.logout')}
            </button>
          </div>
        </>
      )}

      {passports && <DatabaseModal onClose={() => setPassports(false)} />}
    </div>
  );
}

/** The bell in the header, beside Xarita and the gear (owner, 03.11.2026): unread count on it, the list behind it. */
function SellerBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
  });
  const count = unread.data?.unread ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('sellerBoard.notifications')}
        title={t('sellerBoard.notifications')}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-panel2 text-paper hover:bg-[#28303d]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-mono text-[10px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && <NotificationsModal onClose={() => setOpen(false)} />}
    </>
  );
}


/**
 * The same notifications the console shows, in the board's own clothes. A tap
 * opens one — its order, in full — and marks that one read; the rest stay
 * unread until they are opened in turn.
 */
function NotificationsModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<NotificationPublic[]>('/notifications'),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const items = list.data ?? [];
  const words = (n: NotificationPublic) => {
    const titleKey = `notificationType.${n.type}.title`;
    const bodyKey = `notificationType.${n.type}.body`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tf = t as any;
    return {
      title: (i18n.exists(titleKey) ? tf(titleKey) : n.title) as string,
      body: (i18n.exists(bodyKey) ? tf(bodyKey, { client: n.client_name ?? t('sellerBoard.client') }) : n.body) as string,
    };
  };
  const open = items.find((n) => n.id === openId) ?? null;
  const show = (n: NotificationPublic) => {
    setOpenId(n.id);
    if (!n.read_at) markOne.mutate(n.id);
  };

  return (
    <ModalShell title={t('sellerBoard.notifications')} onClose={onClose}>
      {open ? (
        <NotificationDetail n={open} {...words(open)} onBack={() => setOpenId(null)} />
      ) : list.isLoading ? (
        <div className="py-8 text-center text-sm text-slate-light">{t('notifications.loading')}</div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-light">{t('notifications.allCaughtUp')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((n) => {
            const { title, body } = words(n);
            return (
              <button
                type="button"
                key={n.id}
                onClick={() => show(n)}
                className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-left hover:bg-[#182234] ${
                  n.read_at ? 'border-hairline bg-[#12181f]' : 'border-brand/50 bg-[#141d2b]'
                }`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-brand'}`} />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm text-paper ${n.read_at ? 'font-medium' : 'font-bold'}`}>{title}</div>
                  <div className="text-sm text-slate-light">{body}</div>
                  <div className="mt-0.5 font-mono text-xs text-slate">{formatDateTime(n.created_at)}</div>
                </div>
                <span className="mt-1 text-slate">›</span>
              </button>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}

/** One notification, opened: what it says, and the order it is about. */
function NotificationDetail({
  n,
  title,
  body,
  onBack,
}: {
  n: NotificationPublic;
  title: string;
  body: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const orderQ = useQuery({
    queryKey: ['order', n.related_order_id],
    queryFn: () => api.get<OrderPublic>(`/orders/${n.related_order_id}`),
    enabled: !!n.related_order_id,
  });
  const o = orderQ.data;
  const row = (k: string, v: string | null | undefined) =>
    v ? (
      <div className="flex gap-3 border-b border-hairline py-2 last:border-0">
        <span className="w-36 shrink-0 text-sm text-slate">{k}</span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-paper">{v}</span>
      </div>
    ) : null;
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 text-sm font-medium text-slate-light hover:text-paper">
        ← {t('sellerBoard.notificationsBack')}
      </button>
      <div className="rounded-xl border border-hairline bg-[#12181f] p-4">
        <div className="text-base font-bold text-paper">{title}</div>
        <div className="mt-1 text-sm text-slate-light">{body}</div>
        <div className="mt-1 font-mono text-xs text-slate">{formatDateTime(n.created_at)}</div>
      </div>
      {n.related_order_id && (
        <div className="mt-3 rounded-xl border border-hairline bg-[#12181f] p-4">
          {orderQ.isLoading ? (
            <div className="text-sm text-slate-light">{t('notifications.loading')}</div>
          ) : !o ? (
            <div className="text-sm text-slate-light">—</div>
          ) : (
            <>
              {row(t('sellerBoard.client'), o.client_name)}
              {row(t('sellerBoard.notifAddress'), o.client_address)}
              {row(t('sellerBoard.notifStatus'), t(`orderStatus.${o.status}` as 'orderStatus.delivered'))}
              {row(t('sellerBoard.notifDriver'), o.assigned_driver_name)}
              {row(t('sellerBoard.notifPickup'), o.pickup_sources.map((s) => s.name).join(' → '))}
              {row(t('sellerBoard.notifCargo'), o.cargo_type_name)}
              {o.proof_photo_url && (
                <a href={safeHref(o.proof_photo_url)} target="_blank" rel="noreferrer" className="mt-3 block">
                  <div className="mb-1 text-xs uppercase tracking-wide text-slate">{t('sellerBoard.notifPhoto')}</div>
                  <img src={o.proof_photo_url} alt="" className="max-h-72 w-full rounded-lg object-cover" />
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Queue modal (occupied truck) ---
/** One unfinished hold in the queue: whose it is, how long its seven minutes
 *  have left, and — when it is his — the way back into the form or out of it. */
function HoldRow({ h, onResume, onCancel }: { h: PendingHold; onResume: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const timer = useCountdown(h.fill_deadline);
  return (
    <div className="rounded-xl border border-hairline border-l-4 border-l-booked bg-[#12181f] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-booked">
          ⏳ {t('sellerBoard.awaitingInfo')} — {h.booked_by_name ?? '—'}
          {h.is_backhaul ? ' · 📍' : ''}
          {h.fill_deadline && !timer.expired && (
            <span className={`ml-2 font-mono tabular-nums ${timer.critical ? 'text-full' : ''}`}>{timer.label}</span>
          )}
        </span>
        {h.mine && (
          <div className="flex gap-2">
            <button type="button" onClick={onResume} className="text-sm font-semibold text-brand hover:underline">
              {t('sellerBoard.fillNow')}
            </button>
            <button type="button" onClick={onCancel} className="text-sm font-semibold text-full hover:underline">
              {t('sellerBoard.otmen')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function QueueModal({
  vehicle,
  onlyMine = false,
  onClose,
  onOpenSession,
  onChanged,
}: {
  vehicle: BoardVehicle;
  /** From Mening zakazlarim: his own orders and holds on the lorry, nobody else's. */
  onlyMine?: boolean;
  onClose: () => void;
  onOpenSession: (s: BookingSession) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const boardBase = useBoardBase();
  const queueQ = useQuery({
    queryKey: ['seller-queue', vehicle.id],
    queryFn: () => api.get<VehicleQueue>(`/seller/vehicles/${vehicle.id}/queue`),
  });
  const bronM = useMutation({
    mutationFn: (mode: BookingMode) =>
      api.post<ReserveResult>(`/seller/vehicles/${vehicle.id}/reserve`, { kind: 'bron', mode }),
    onSuccess: (s) => onOpenSession(s),
  });
  const poputiM = useMutation({
    mutationFn: () => api.post<ReserveResult>(`/seller/vehicles/${vehicle.id}/poputi`, {}),
    onSuccess: (s) => onOpenSession(s),
  });
  const resumeM = useMutation({
    mutationFn: (groupId: string) => api.get<BookingSession>(`/seller/bookings/${groupId}`),
    onSuccess: (s) => onOpenSession(s),
  });
  // His Polniy, his lorry: the next order goes into the same booking.
  const addNextM = useMutation({
    mutationFn: (groupId: string) => api.post<BookingSession>(`/seller/bookings/${groupId}/next`, {}),
    onSuccess: (s) => onOpenSession(s),
  });
  const cancelM = useMutation({
    mutationFn: (rid: string) => api.del(`/seller/reservations/${rid}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-queue', vehicle.id] });
      onChanged();
    },
  });
  const q = queueQ.data
    ? onlyMine
      ? {
          ...queueQ.data,
          orders: queueQ.data.orders.filter((o) => o.mine),
          holds: queueQ.data.holds.filter((h) => h.mine),
        }
      : queueQ.data
    : undefined;
  // The board already works out which order is being driven — lowest queue
  // position among the committed ones. Trusting the list's first row instead
  // would be wrong the moment one of them has not started.
  const currentId = vehicle.current_order_id ?? q?.orders[0]?.id ?? null;
  const current = q?.orders.find((o) => o.id === currentId) ?? null;
  // A po puti co-load is aboard the current order, not behind it. Listing it
  // under "in queue" as position 2 says the driver will do it afterwards,
  // which is the opposite of what riding along means.
  const coloads = (q?.orders ?? []).filter((o) => o.rides_with_order_id != null);
  const coloadIds = new Set(coloads.map((o) => o.id));
  const queued = (q?.orders ?? []).filter((o) => o.id !== currentId && !coloadIds.has(o.id));
  // Nothing left on the lorry — the last order was cancelled, the last hold
  // let go — and the window has nothing to show: it closes, and the board
  // behind it lists the lorry among the free ones.
  const emptied = !!q && q.orders.length === 0 && q.holds.length === 0;
  // His vozvrat, written up at the client, waits for him: that is all this
  // window is for until he has confirmed it or sent it back — no booking
  // buttons, and the request itself on top, not behind "Batafsil".
  const reviewing =
    q?.orders.find(
      (o) => o.mine && o.status === 'returning' && o.return_items_written > 0 && !o.return_items_confirmed,
    ) ?? null;
  useEffect(() => {
    if (emptied) {
      onChanged();
      onClose();
    }
  }, [emptied, onChanged, onClose]);
  return (
    <ModalShell
      title={`${vehicle.model} · ${vehicle.plate_number}`}
      onClose={onClose}
      headerAction={
        <span className="text-lg font-extrabold text-brand">
          {t('sellerBoard.queueN', { n: (q?.orders.length ?? 0) + (q?.holds.length ?? 0) })}
        </span>
      }
    >
      <VehicleInfo vehicle={vehicle} status={vehicle.board_status} />
      {(bronM.isError || poputiM.isError) && (
        <ErrorLine msg={poputiM.isError ? t('sellerBoard.errPoputi') : t('sellerBoard.errFull')} />
      )}
      {reviewing ? (
        <button
          type="button"
          onClick={() => navigate(`${boardBase}/vozvrat-review/${reviewing.id}`)}
          className="mb-2 w-full rounded-xl border-2 border-[#f59e0b] bg-[#2a1f0a] p-4 text-left hover:bg-[#3a2b0e]"
        >
          <div className="text-base font-bold text-[#fbbf24]">
            ↩ {t('sellerBoard.returnRequest')} · {reviewing.client_name}
          </div>
          <div className="mt-1 text-sm text-slate-light">{t('sellerBoard.returnRequestOpen')}</div>
        </button>
      ) : (
        <>
      {/* Adding to this lorry is one thing; what is already on it is another.
          Each gets a heading, so the two never read as one list. */}
      <div className="mb-1.5 px-0.5 text-[11px] uppercase tracking-widest text-slate">
        ➕ {t('sellerBoard.addOrderHere')}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {q?.my_full_group_id ? (
          <ActionBtn
            kind="brand"
            onClick={() => addNextM.mutate(q.my_full_group_id!)}
            disabled={addNextM.isPending}
          >
            {t('sellerBoard.bronFullNext')}
          </ActionBtn>
        ) : (
          <>
        <ActionBtn
          kind="brand"
          onClick={() => bronM.mutate('single')}
          disabled={bronM.isPending || vehicle.board_status === 'full'}
        >
          {t('sellerBoard.bron')}
        </ActionBtn>
        <ActionBtn
          kind="brand2"
          onClick={() => bronM.mutate('double')}
          disabled={bronM.isPending || vehicle.board_status === 'full'}
        >
          {t('sellerBoard.bron2x')}
        </ActionBtn>
        <ActionBtn
          kind="neutral"
          onClick={() => bronM.mutate('full')}
          disabled={bronM.isPending || vehicle.board_status === 'full'}
        >
          {t('sellerBoard.bronFull')}
        </ActionBtn>
          </>
        )}
        <ActionBtn kind="outline" onClick={() => poputiM.mutate()} disabled={poputiM.isPending}>
          📍 {t('sellerBoard.poputi')}
        </ActionBtn>
      </div>
        </>
      )}

      {/* Otmen and "to'ldirish" used to fail in silence: the hold stayed where
          it was and the seller had no idea why. */}
      {cancelM.isError && <ErrorLine msg={t('sellerBoard.errCancel')} />}
      {resumeM.isError && <ErrorLine msg={t('sellerBoard.errFill')} />}
      {addNextM.isError && <ErrorLine msg={t('sellerBoard.errFill')} />}

      {!reviewing && (
        <>
      <div className="mb-2 mt-4 px-0.5">
        <span className="text-[11px] uppercase tracking-widest text-slate">
          🚚 {t('sellerBoard.ordersOnLorry')}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {q?.holds.map((h) => (
          <HoldRow
            key={h.reservation_id}
            h={h}
            onResume={() => (h.group_id ? resumeM.mutate(h.group_id) : undefined)}
            onCancel={() => cancelM.mutate(h.reservation_id)}
          />
        ))}
        {current && (
          <>
            <div className="mb-1 mt-3 px-0.5">
              <span className="text-[11px] uppercase tracking-widest text-slate">
                {t('sellerBoard.drivingNow')}
              </span>
            </div>
            <CurrentOrderCard
              order={current}
              coloads={coloads.filter((o) => o.rides_with_order_id === current.id)}
              vehicleId={vehicle.id}
              onChanged={onChanged}
            />
          </>
        )}

        {queued.length > 0 && (
          <>
            <div className="mb-1 mt-3 flex items-baseline gap-2 px-0.5">
              <span className="text-[11px] uppercase tracking-widest text-slate">
                {t('sellerBoard.inQueue')}
              </span>
              <span className="text-[11px] font-semibold text-slate">
                {t('sellerBoard.queueCount', { n: queued.length })}
              </span>
            </div>
            {queued.map((o, i) => (
              <QueuedOrderRow
                key={o.id}
                order={o}
                position={i + (current ? 2 : 1)}
                vehicleId={vehicle.id}
                onChanged={onChanged}
              />
            ))}
          </>
        )}

        {q && q.orders.length === 0 && q.holds.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-light">{t('sellerBoard.emptyQueue')}</p>
        )}
      </div>
        </>
      )}
    </ModalShell>
  );
}

/**
 * The order the driver is actually on.
 *
 * The queue used to be three identical cards of six fields each, with nothing
 * saying which one was moving — `current_order_id` was in the response and
 * unused. This one is lifted and carries its progress; the rest collapse.
 */
/** One node on the rail: a pickup, or an order's client stop. */
type TripStop = {
  key: string;
  label: string;
  /** Order number, shown only when the rail carries more than one order. */
  tag: string | null;
  done: boolean;
  isPickup: boolean;
};

/**
 * The stops the driver will make, in the order they will be made.
 *
 * With one order that is simply its pickups and then the client. With a po puti
 * co-load it is both orders' stops interleaved, which is what the trip
 * positions record — they are written precisely because the sequence can no
 * longer be derived from either order alone.
 */
function tripStops(orders: SellerOrder[], clientLabel: string): TripStop[] {
  const multi = orders.length > 1;
  const stops = orders.flatMap((o) => [
    ...o.pickup_sources.map((src, i) => ({
      key: `${o.id}-p${i}`,
      label: src.name,
      tag: multi ? (o.client_name ?? clientLabel) : null,
      done: src.leg_status === 'arrived',
      isPickup: true,
      at: src.trip_position,
    })),
    {
      key: `${o.id}-d`,
      label: multi ? (o.client_name ?? clientLabel) : clientLabel,
      tag: null,
      done: o.status === 'delivered',
      isPickup: false,
      at: o.delivery_trip_position,
    },
  ]);
  // Sort only when every stop knows where it belongs; a half-written trip keeps
  // the per-order order rather than inventing one.
  const ordered = stops.every((st) => st.at != null)
    ? [...stops].sort((a, b) => a.at! - b.at!)
    : stops;
  return ordered.map(({ at: _at, ...rest }) => rest);
}

/** Says a card is a return, so it is never read as a delivery. */
function VozvratBadge() {
  const { t } = useTranslation();
  return (
    <span className="rounded-full bg-[#3b2a0a] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#f5b544]">
      ↩ {t('sellerBoard.vozvrat')}
    </span>
  );
}

/**
 * A click anywhere on an order card opens or closes its details — except on
 * something that does its own thing (a button, a field, a link).
 */
function toggleOnCard(set: (f: (v: boolean) => boolean) => void) {
  return (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, label')) return;
    e.stopPropagation();
    set((v) => !v);
  };
}

function CurrentOrderCard({
  order,
  coloads,
  vehicleId,
  onChanged,
}: {
  order: SellerOrder;
  coloads: SellerOrder[];
  vehicleId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const stops = tripStops([order, ...coloads], t('sellerBoard.client'));
  // "Collected" counts pickups: a delivery is dropped off, not taken.
  const pickups = stops.filter((st) => st.isPickup);
  const doneCount = pickups.filter((st) => st.done).length;
  const currentIdx = stops.findIndex((st) => !st.done);

  return (
    <div className="cursor-pointer rounded-xl border border-brand/60 bg-brand/[0.07] p-3.5" onClick={toggleOnCard(setOpen)}>
      <div className="flex items-center gap-2.5">
        <span className="font-display text-base font-bold">{clientNameOf(order, t('sellerBoard.otherClient'))}</span>
        <OrderStatusChip status={order.status} />
        {order.is_vozvrat && <VozvratBadge />}
        <CarriedOverNote carried={order.carried_over} compact />
        <span className="flex-1" />
        {order.poputi_allowed && (
          <span className="rounded-full bg-free-bg px-2.5 py-0.5 text-[10px] font-bold text-free">
            {t('sellerBoard.poputiOk')}
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-slate-light">
        {orderSummary(order)}
      </div>

      {stops.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5">
            {stops.map((st, i) => (
              <span
                key={st.key}
                className={`flex items-center gap-1.5 ${i === stops.length - 1 ? 'flex-none' : 'flex-1'}`}
              >
                <span
                  className={`h-2.5 w-2.5 flex-none rounded-full ${
                    st.done
                      ? 'bg-free'
                      : i === currentIdx
                        ? 'bg-brand ring-4 ring-brand/25'
                        : 'border-2 border-hairline'
                  }`}
                />
                {i < stops.length - 1 && (
                  <span className={`h-0.5 flex-1 ${st.done ? 'bg-free' : 'bg-hairline'}`} />
                )}
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex text-[10px] font-semibold">
            {stops.map((st, i) => (
              <span
                key={`${st.key}-label`}
                className={`truncate ${i === stops.length - 1 ? 'flex-none' : 'flex-1'} ${
                  st.done ? 'text-free' : i === currentIdx ? 'font-bold text-brand' : 'text-slate'
                }`}
              >
                {st.label}
                {st.tag != null && <span className="ml-1 text-slate">· {st.tag}</span>}
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            {currentIdx >= 0 && (
              <span className="rounded-full bg-panel2 px-2 py-0.5 text-brand">
                {t('sellerBoard.nowAt', { place: stops[currentIdx]!.label })}
              </span>
            )}
            <span className="text-slate">{t('sellerBoard.stopsDone', { done: doneCount, total: pickups.length })}</span>
          </div>
        </div>
      )}

      {coloads.map((c) => (
        <ColoadBlock key={c.id} order={c} vehicleId={vehicleId} onChanged={onChanged} />
      ))}

      {order.mine && <SellerEta orderId={order.id} className="mt-3" />}

      {open && (
        <div className="mt-3 border-t border-hairline pt-2.5">
          <OrderFieldGrid order={order} />
          <ExceptionReport order={order} />
          {order.carried_over && (
            <div className="mt-2">
              <CarriedOverNote carried={order.carried_over} />
            </div>
          )}
        </div>
      )}

      {/* Two different things, kept apart: more to read on the left, the
          one destructive act on the right, on a line of their own. */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-hairline pt-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-hairline bg-panel2 px-3 py-1.5 text-xs font-semibold text-slate-light hover:text-paper"
        >
          {open ? t('sellerBoard.hideDetails') : t('sellerBoard.showDetails')}
        </button>
        <SellerStartEarlier order={order} vehicleId={vehicleId} onChanged={onChanged} />
        <SellerOrderCancel order={order} vehicleId={vehicleId} onChanged={onChanged} />
      </div>
    </div>
  );
}

/**
 * A po puti co-load, shown inside the order it rides with.
 *
 * It is a separate order — another seller's cargo, its own client, its own
 * cancel — but it is not a separate journey, so it lives in the host's card
 * rather than in the queue below it.
 */
function ColoadBlock({
  order,
  vehicleId,
  onChanged,
}: {
  order: SellerOrder;
  vehicleId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 cursor-pointer rounded-lg border border-brand/30 bg-brand/[0.06] p-2.5" onClick={toggleOnCard(setOpen)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
          📍 {t('sellerBoard.poputi')}
        </span>
        <span className="text-sm font-bold">{clientNameOf(order, t('sellerBoard.otherClient'))}</span>
        <OrderStatusChip status={order.status} />
        {order.is_vozvrat && <VozvratBadge />}
        <CarriedOverNote carried={order.carried_over} compact />
      </button>
      <div className="mt-0.5 text-xs text-slate-light">{orderSummary(order)}</div>
      {/* The seller whose order it rides with sees what it costs his client (owner, 10.11.2026). */}
      {!order.mine && order.poputi_detour_min != null && (
        <div className="mt-2 rounded-lg bg-booked-bg px-2.5 py-2 text-sm font-bold text-booked">
          {t('sellerBoard.poputiHostDelay', { min: order.poputi_detour_min })}
        </div>
      )}
      {open && (
        <div className="mt-2.5 border-t border-hairline pt-2.5">
          <OrderFieldGrid order={order} />
          <ExceptionReport order={order} />
          {order.carried_over && (
            <div className="mt-2">
              <CarriedOverNote carried={order.carried_over} />
            </div>
          )}
        </div>
      )}
      <div className="mt-2.5 flex justify-end">
        <SellerStartEarlier order={order} vehicleId={vehicleId} onChanged={onChanged} />
        <SellerOrderCancel order={order} vehicleId={vehicleId} onChanged={onChanged} />
      </div>
    </div>
  );
}

/**
 * Today's finished work, under the running lorries on "Mening zakazlarim".
 *
 * The board above only knows about trucks that are still out; an order that
 * has been delivered leaves it, and the seller is left wondering whether it
 * happened. This is the rest of his day: delivered, returned or cancelled,
 * newest first, with the client and the hour.
 */
function MyFinishedOrders() {
  const { t } = useTranslation();
  const ordersQ = useQuery({
    queryKey: ['orders', 'page', 'mine-finished'],
    queryFn: () => api.get<OrderPage>('/orders/page?skip=0&take=200'),
    refetchInterval: 60_000,
  });
  // One row per day, newest first; a day opens on its row and closes when
  // another is opened (owner, 03.11.2026): the list used to grow line by
  // line until the order he was after was lost in it.
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  const today = dayOf(new Date().toISOString());
  const [openDay, setOpenDay] = useState<string | null>(today);
  const finished = (ordersQ.data?.items ?? []).filter((o) => FINISHED_STATUSES.includes(o.status));
  if (finished.length === 0) return null;
  const days = new Map<string, typeof finished>();
  for (const o of finished) {
    const k = dayOf(o.updated_at);
    days.set(k, [...(days.get(k) ?? []), o]);
  }
  const order = (k: string) => k.split('.').reverse().join('');
  const rows = [...days.entries()].sort((x, y) => order(y[0]).localeCompare(order(x[0])));
  return (
    <div className="mt-8 border-t border-hairline pt-5">
      <div className="mb-2.5 rounded-lg border border-hairline bg-panel2 px-3.5 py-2.5 text-sm font-bold tracking-wide text-slate-light">
        {t('sellerBoard.finishedToday')} • <span className="text-paper">{finished.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map(([day, list]) => (
          <div key={day} className="overflow-hidden rounded-xl border border-hairline bg-panel">
            <button
              type="button"
              onClick={() => setOpenDay((d) => (d === day ? null : day))}
              aria-expanded={openDay === day}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-panel2"
            >
              <span className="font-mono font-bold text-paper">{day}</span>
              {day === today && <span className="text-xs font-semibold text-brand">{t('service.ago.today')}</span>}
              <span className="ml-auto font-mono text-xs text-slate-light">{list.length}</span>
              <span className={`text-slate-light transition ${openDay === day ? 'rotate-90' : ''}`}>›</span>
            </button>
            {openDay === day && (
              <div className="flex flex-col gap-1.5 border-t border-hairline px-3 py-2">
                {list.map((o) => (
                  <div key={o.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
                    <span className="font-semibold text-paper">{o.client_name}</span>
                    <OrderStatusChip status={o.status} />
                    {o.kind === 'vozvrat' && <VozvratBadge />}
                    <span className="ml-auto font-mono text-xs text-slate">
                      {new Date(o.updated_at).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Work that has left the board: it happened, or it will not. */
const FINISHED_STATUSES: string[] = ['delivered', 'returned', 'cancelled'];

/** District · cargo · weight · who booked it — the one-line gist of an order. */
/**
 * Which step the driver is on, in the seller's own words.
 *
 * The dots above a card say how far along the route he is; this says what he
 * is doing — accepted, loading, on the road, at the client.
 */

function orderSummary(order: SellerOrder): string {
  return [
    order.district_name,
    order.cargo_type_name,
    order.weight_kg != null ? `${money(order.weight_kg)} kg` : null,
    order.booked_by_name,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** An order waiting its turn: one line, and everything else a click away. */
function QueuedOrderRow({
  order,
  position,
  vehicleId,
  onChanged,
}: {
  order: SellerOrder;
  position: number;
  vehicleId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="cursor-pointer rounded-xl border border-hairline bg-[#12181f] p-3.5" onClick={toggleOnCard(setOpen)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <span className="text-sm font-bold">{clientNameOf(order, t('sellerBoard.otherClient'))}</span>
        <OrderStatusChip status={order.status} />
        {order.is_vozvrat && <VozvratBadge />}
        <CarriedOverNote carried={order.carried_over} compact />
        <span className="flex-1" />
        <span className="text-[11px] font-semibold text-slate">
          {t('sellerBoard.queuePosition', { n: position })}
        </span>
      </button>
      <div className="mt-0.5 text-xs text-slate-light">
        {orderSummary(order)}
      </div>
      {open && (
        <div className="mt-2.5 border-t border-hairline pt-2.5">
          <OrderFieldGrid order={order} />
          <ExceptionReport order={order} />
          {order.carried_over && (
            <div className="mt-2">
              <CarriedOverNote carried={order.carried_over} />
            </div>
          )}
        </div>
      )}
      <div className="mt-2.5 flex justify-end">
        <SellerStartEarlier order={order} vehicleId={vehicleId} onChanged={onChanged} />
        <SellerOrderCancel order={order} vehicleId={vehicleId} onChanged={onChanged} />
      </div>
    </div>
  );
}

/** The six fields the queue used to show on every card, now shown on demand. */
function OrderFieldGrid({ order }: { order: SellerOrder }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2.5 text-sm">
      <Field k={t('sellerBoard.bookedBy')} v={order.booked_by_name} />
      <Field k={t('sellerBoard.cargo')} v={order.cargo_type_name} />
      <Field
        k={t('sellerBoard.weight')}
        v={order.weight_kg != null ? `${money(order.weight_kg)} kg` : null}
        mono
      />
      <Field k={t('sellerBoard.client')} v={order.client_name} />
      <Field k={t('sellerBoard.district')} v={order.district_name} />
      <Field k={t('sellerBoard.waybill')} v={order.waybill_source} />
    </div>
  );
}

const ORDER_CANCEL_REASONS = ['client', 'supplier', 'mistake'] as const;
const VOZVRAT_CANCEL_REASONS = ['mistake', 'postponed', 'client'] as const;
const CANCEL_REASON_ICON: Record<(typeof ORDER_CANCEL_REASONS | typeof VOZVRAT_CANCEL_REASONS)[number], string> = {
  client: '👤',
  supplier: '🏭',
  mistake: '✋',
  postponed: '⏳',
};

/**
 * An Ertangi order booked for after 09:00: the client may call and want it
 * first thing after all. One tap moves it, and the driver is told.
 */
function SellerStartEarlier({
  order,
  vehicleId,
  onChanged,
}: {
  order: SellerOrder;
  vehicleId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const m = useMutation({
    mutationFn: () => api.patch(`/seller/orders/${order.id}/start-time`, { start_after_nine: false }),
    onSuccess: () => {
      setConfirm(false);
      queryClient.setQueryData<VehicleQueue>(['seller-queue', vehicleId], (q) =>
        q ? { ...q, orders: q.orders.map((o) => (o.id === order.id ? { ...o, start_after_nine: false } : o)) } : q,
      );
      void queryClient.invalidateQueries({ queryKey: ['seller-queue', vehicleId] });
      onChanged();
    },
  });
  const notStarted = ['created', 'assigned_to_driver', 'driver_accepted'].includes(order.status);
  if (!order.mine || !order.start_after_nine || !notStarted) return null;

  return (
    <>
      <button
        type="button"
        className="rounded-lg border border-booked/50 bg-booked-bg px-3 py-1.5 text-xs font-bold text-booked hover:border-booked"
        onClick={() => {
          m.reset();
          setConfirm(true);
        }}
      >
        🕘 {t('sellerBoard.startAfter9')} · {t('sellerBoard.moveBefore9')}
      </button>
      {confirm && (
        <ModalShell title={t('sellerBoard.moveBefore9Title')} onClose={() => !m.isPending && setConfirm(false)}>
          {m.isError && <ErrorLine msg={t('sellerBoard.errMoveBefore9')} />}
          <p className="mb-4 text-sm text-slate-light">{t('sellerBoard.moveBefore9Body')}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <ActionBtn kind="neutral" onClick={() => setConfirm(false)} disabled={m.isPending}>
              {t('common.cancel')}
            </ActionBtn>
            <ActionBtn kind="brand" onClick={() => m.mutate()} disabled={m.isPending}>
              {t('sellerBoard.startBefore9')}
            </ActionBtn>
          </div>
        </ModalShell>
      )}
    </>
  );
}

/** The two start times, side by side: after 09:00 green on the left, before yellow on the right. */
function StartTimeButtons({
  value,
  onPick,
  disabled,
}: {
  value: 'before' | 'after' | null;
  onPick: (k: 'before' | 'after') => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {(['after', 'before'] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onPick(k)}
          disabled={disabled}
          aria-pressed={value === k}
          className={`rounded-lg border-2 px-3 py-3 text-sm font-bold transition-colors disabled:opacity-60 ${
            k === 'before'
              ? value === k
                ? 'border-booked bg-booked text-[#1f1a10]'
                : 'border-booked/60 bg-booked-bg text-booked hover:border-booked'
              : value === k
                ? 'border-free bg-free text-white'
                : 'border-free/60 bg-free-bg text-free hover:border-free'
          }`}
        >
          {k === 'before' ? t('sellerBoard.startBefore9') : t('sellerBoard.startAfter9')}
        </button>
      ))}
    </div>
  );
}

/** One of his Ertangi orders: the client's name and its start time, switched with one tap. */
function MyBronTime({ order, vehicleId }: { order: SellerOrder; vehicleId: string }) {
  const { t } = useTranslation();
  const m = useMutation({
    mutationFn: (after: boolean) => api.patch(`/seller/orders/${order.id}/start-time`, { start_after_nine: after }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['seller-queue', vehicleId] }),
  });
  const value = order.start_after_nine ? 'after' : 'before';
  return (
    <div>
      <div className="mb-1.5 text-sm text-slate-light">
        {t('sellerBoard.client')}: <span className="font-semibold text-paper">{clientNameOf(order, t('sellerBoard.otherClient'))}</span>
      </div>
      {m.isError && <ErrorLine msg={t('sellerBoard.errMoveBefore9')} />}
      <StartTimeButtons
        value={value}
        disabled={m.isPending}
        onPick={(k) => {
          if (k !== value) m.mutate(k === 'after');
        }}
      />
    </div>
  );
}

function SellerOrderCancel({
  order,
  vehicleId,
  onChanged,
}: {
  order: SellerOrder;
  vehicleId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const cancelM = useMutation({
    mutationFn: () => api.patch(`/orders/${order.id}/cancel`, { reason: reason.trim() }),
    onSuccess: () => {
      setOpen(false);
      setReason('');
      setAttempted(false);
      // The order is gone from the lorry's queue this instant, before the
      // server is asked again: a window left on "Navbat bo'sh" for the
      // length of a round trip read as nothing having happened.
      queryClient.setQueryData<VehicleQueue>(['seller-queue', vehicleId], (q) =>
        q ? { ...q, orders: q.orders.filter((o) => o.id !== order.id) } : q,
      );
      void queryClient.invalidateQueries({ queryKey: ['seller-queue', vehicleId] });
      onChanged();
    },
  });
  const close = () => {
    if (cancelM.isPending) return;
    setOpen(false);
    setReason('');
    setAttempted(false);
    cancelM.reset();
  };
  const cancellable = (CANCELLABLE_ORDER_STATUSES as readonly string[]).includes(
    order.status,
  );

  if (!order.mine || !cancellable) return null;

  return (
    <>
      <button
        type="button"
        className="rounded-lg border border-full/50 bg-full-bg px-3 py-1.5 text-xs font-bold text-full hover:border-full"
        onClick={() => {
          setOpen(true);
          setReason('');
          setAttempted(false);
          cancelM.reset();
        }}
      >
        ✕ {t('sellerBoard.cancelOrder')}
      </button>
      {open && (
        <ModalShell
          title={t('sellerBoard.cancelOrderTitle', { client: clientNameOf(order, t('sellerBoard.otherClient')) })}
          onClose={close}
        >
          {cancelM.isError && <ErrorLine msg={t('sellerBoard.errCancelOrder')} />}
          {/* One of three reasons, tapped, not typed: a delivery is cancelled
              by the client, by the supplier, or by the seller's own slip; a
              return is the seller's slip, put off, or the client's change of mind. */}
          <Labeled
            label={t('sellerBoard.cancelOrderReason')}
            error={attempted && !reason.trim() ? t('common.requiredField') : undefined}
          >
            <div id={`seller-cancel-order-${order.id}`} className="flex flex-col gap-2.5" role="radiogroup">
              {(order.is_vozvrat ? VOZVRAT_CANCEL_REASONS : ORDER_CANCEL_REASONS).map((key) => {
                const text = t(`sellerBoard.cancelReasons.${key}`);
                const picked = reason === text;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    onClick={() => {
                      setReason(text);
                      setAttempted(false);
                    }}
                    className={`flex items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition ${
                      picked
                        ? 'border-brand bg-brand/15 shadow-[0_0_0_1px_rgba(255,122,24,0.5)]'
                        : 'border-hairline bg-panel2 hover:border-brand/60 hover:bg-panel'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-lg ${
                        picked ? 'bg-brand/25' : 'bg-panel'
                      }`}
                      aria-hidden
                    >
                      {CANCEL_REASON_ICON[key]}
                    </span>
                    <span className={`flex-1 text-[15px] font-bold ${picked ? 'text-brand' : 'text-paper'}`}>{text}</span>
                    <span
                      className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${
                        picked ? 'border-brand bg-brand text-night' : 'border-slate'
                      }`}
                      aria-hidden
                    >
                      {picked && <span className="text-[11px] font-black">✓</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </Labeled>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <ActionBtn kind="neutral" onClick={close} disabled={cancelM.isPending}>
              {t('sellerBoard.keepOrder')}
            </ActionBtn>
            <ActionBtn
              kind="danger"
              disabled={cancelM.isPending}
              onClick={() => {
                setAttempted(true);
                if (!reason.trim()) {
                  document.getElementById(`seller-cancel-order-${order.id}`)?.focus();
                  return;
                }
                cancelM.mutate();
              }}
            >
              {cancelM.isPending
                ? t('sellerBoard.cancellingOrder')
                : t('sellerBoard.confirmCancelOrder')}
            </ActionBtn>
          </div>
        </ModalShell>
      )}
    </>
  );
}
// --- Fill session: tabbed multi-order fill (1-zakaz / 2-zakaz / … ; sequential) ---
function FillSession({
  initial,
  vehicle,
  prefill,
  onClose,
}: {
  initial: BookingSession;
  vehicle: BoardVehicle;
  /** What the seller already typed into the po puti search, so the form they
   *  land on is the one they filled rather than an empty copy of it. */
  prefill?: Prefill;
  onClose: (expired?: boolean, saved?: boolean) => void;
}) {
  const { t } = useTranslation();
  const [session, setSession] = useState<BookingSession>(initial);
  const slots = [...session.slots].sort((a, b) => a.sequence_index - b.sequence_index);
  // The return form, opened from the tab beside the orders.
  const [vozvrat, setVozvrat] = useState(false);
  const [tab, setTab] = useState<number>(
    () => (slots.find((s) => s.status === 'awaiting') ?? slots[0])?.sequence_index ?? 0,
  );

  // Follow the active slot as the booking advances (order 1 filled → order 2 opens).
  useEffect(() => {
    const active = session.slots.find((s) => s.status === 'awaiting');
    if (active) setTab(active.sequence_index);
  }, [session]);

  const addM = useMutation({
    mutationFn: () => api.post<BookingSession>(`/seller/bookings/${session.group_id}/next`, {}),
    onSuccess: (s) => {
      setSession(s);
      setVozvrat(false);
    },
  });

  const done = !slots.some((s) => s.status === 'awaiting' || s.status === 'queued');
  // He has the whole lorry: how many drops it makes is his to say, and he says
  // it up front rather than one at a time after each form is saved.
  const canAdd = session.mode === 'full' && slots.length < 10;
  const current = slots.find((s) => s.sequence_index === tab);
  const activeSlot = slots.find((s) => s.status === 'awaiting');
  const multi = slots.length > 1 || session.mode === 'full';
  // The seven minutes run whatever the seller is looking at. The order form
  // used to watch its own clock, so a timer that ran out while he was on the
  // Vozrat tab — or on a filled order — left the window open over a hold the
  // server had already let go, and only a browser refresh showed him that.
  const sessionTimer = useCountdown(activeSlot?.fill_deadline ?? null);
  const expired = !!activeSlot?.fill_deadline && sessionTimer.expired;
  useEffect(() => {
    if (expired) onClose(true);
  }, [expired, onClose]);
  // Every slot saved and nothing more to add: the work is done, so the window
  // goes with it. A summary with a Yopish button under it was one tap for
  // nothing on every single booking.
  // Every slot saved: the window goes, and he lands on Mening zakazlarim. A
  // Polniy too (owner, 02.11.2026) — its next order is added from the lorry's
  // card, not from a summary page left open over the board.
  useEffect(() => {
    if (done && !vozvrat && slots.length > 0) onClose(false, true);
  }, [done, vozvrat, slots.length, onClose]);
  // Closing the window is not giving the lorry back. The seven minutes are
  // his to use — he may be on the phone to the client, or have shut this by
  // accident — so the hold stands until it expires or he cancels it with the
  // button that says so. Until then the truck stays in Zanyat and in Mening
  // zakazlarim, and tapping it opens this form again where he left it.
  const closeSession = () => onClose();
  // A return was booked instead of an order: the capacity hold this window was
  // opened with is not wanted, and it must not sit on the truck for the rest of
  // its seven minutes. Released whether or not the server still has it — it
  // expires on its own, and a failure there is no reason to keep the seller in
  // a window whose work is already done.
  const finishWithVozvrat = () => {
    if (!activeSlot) return onClose();
    void api
      .del(`/seller/reservations/${activeSlot.reservation_id}`)
      .catch(() => undefined)
      .finally(() => onClose());
  };

  return (
    <ModalShell
      title={`${t('sellerBoard.fillTitle')}: ${vehicle.model} · ${vehicle.plate_number}`}
      onClose={closeSession}
      minimize
    >
      {addM.isError && <ErrorLine msg={t('sellerBoard.errAddOrder')} />}
      <div className="mb-4 rounded-lg border border-hairline border-l-[3px] border-l-brand bg-panel2 px-3.5 py-2.5 font-mono text-sm">
        {t('sellerBoard.limit')}: {limitText(vehicle)}
      </div>

      {/* Shown even for a single order, because Vozrat lives beside it: the
          seller has the truck in front of him here, and sending him to another
          page to book a return meant choosing the lorry a second time. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(multi ? slots : slots.slice(0, 1)).map((s, i) => (
          <button
            key={s.reservation_id}
            type="button"
            onClick={() => {
              setVozvrat(false);
              setTab(s.sequence_index);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              s.sequence_index === tab && !vozvrat
                ? 'seller-pill-on'
                : 'bg-panel2 text-slate-light hover:text-paper'
            }`}
          >
            {/* A single booking has one order; "1-zakaz" implied a second.
                Numbered by place among the slots shown: a slot he cancelled
                is gone, and the next one is not "6-zakaz" after it. */}
            {multi ? t('sellerBoard.orderN', { n: i + 1 }) : t('sellerBoard.orderOne')}
            {s.status === 'filled' ? ' ✓' : s.status === 'queued' ? ' 🔒' : ''}
          </button>
        ))}
        {canAdd && (
          <button
            type="button"
            onClick={() => addM.mutate()}
            disabled={addM.isPending}
            title={t('sellerBoard.addOrder')}
            aria-label={t('sellerBoard.addOrder')}
            className="rounded-lg border border-[#26344a] bg-[#182234] px-3 py-1.5 text-base font-bold leading-5 text-brand hover:bg-panel2 disabled:opacity-50"
          >
            +
          </button>
        )}
        <button
          type="button"
          onClick={() => setVozvrat(true)}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            vozvrat
              ? 'seller-pill-on'
              : 'border border-[#26344a] bg-[#182234] text-[#9db4d6] hover:text-paper'
          }`}
        >
          ↩ {t('sellerBoard.tabVozvrat')}
        </button>
        {/* The seven minutes: after the tabs, on the same row, not inside a button. */}
        {activeSlot?.fill_deadline && !sessionTimer.expired && (
          <span
            className={`ml-1 font-mono text-base font-bold tabular-nums ${sessionTimer.critical ? 'text-full' : 'text-booked'}`}
          >
            ⏳ {sessionTimer.label}
          </span>
        )}
      </div>

      {vozvrat && (
        <VozvratForm vehicle={vehicle} onCreated={finishWithVozvrat} onCancel={() => setVozvrat(false)} />
      )}

      {!vozvrat && current?.status === 'awaiting' && (
        <OrderForm
          key={current.reservation_id}
          slot={current}
          vehicleCapacityKg={vehicle.capacity_kg}
          prefill={current.sequence_index === 0 ? prefill : undefined}
          onFilled={(s) => setSession(s)}
          onCancelled={onClose}
        />
      )}
      {!vozvrat && current?.status === 'queued' && (
        <div className="rounded-lg border border-hairline bg-panel2 px-4 py-8 text-center text-sm text-slate-light">
          🔒 {t('sellerBoard.lockedUntilPrev')}
        </div>
      )}
      {!vozvrat && current?.status === 'filled' && current.order && (
        <FilledSummary order={current.order} />
      )}

      {!vozvrat && done && (
        <div className="mt-4 flex flex-col gap-2.5">
          {!canAdd && (
            <div className="rounded-lg border border-free/40 bg-free-bg px-3.5 py-2.5 text-center text-sm font-bold text-free">
              ✓ {t('sellerBoard.allFilled')}
            </div>
          )}
          <ActionBtn kind="neutral" onClick={closeSession}>
            {t('sellerBoard.close')}
          </ActionBtn>
        </div>
      )}
    </ModalShell>
  );
}

/**
 * A return, booked in the window the seller already has open.
 *
 * Same four answers as the Vozrat page — whose goods, from which delivery,
 * where they go back to, and which lorry fetches them — with the lorry already
 * set to the one he was looking at. There is no "when": a return booked from
 * this board is today's work, like everything else on it.
 */
function VozvratForm({
  vehicle,
  onCreated,
  onCancel,
}: {
  vehicle: BoardVehicle;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState('');
  // The delivery it comes from is the office's to tie up later; the seller
  // is not asked, and the order is created unlinked.
  const originalOrderId = '';
  const [placeId, setPlaceId] = useState('');
  const driverId = vehicle.driver_id ?? '';
  const [comment, setComment] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placesQ = useQuery({
    queryKey: ['pickup-places'],
    queryFn: () => api.get<PickupPlacePublic[]>('/pickup-places'),
  });
  // Where the lorry actually goes to collect: the client's own address. The
  // form never asks for it — there is nowhere else a return could start — but
  // it was left unsaid, and a seller cannot tell a driver "fetch it" without
  // seeing that the address is there at all.
  const addressesQ = useQuery({
    queryKey: ['client-addresses', clientId],
    queryFn: () => api.get<ClientAddressPublic[]>(`/clients/${clientId}/addresses`),
    enabled: !!clientId,
  });
  const collectFrom =
    (addressesQ.data ?? []).filter((a) => a.active).find((a) => a.is_default) ??
    (addressesQ.data ?? []).filter((a) => a.active)[0] ??
    null;


  const createM = useMutation({
    mutationFn: async () => {
      const order = await api.post<OrderPublic>('/orders/vozvrat', {
        client_id: clientId,
        client_address_id: null,
        original_order_id: originalOrderId || null,
        pickup_place_id: placeId,
        // Booked for now: this board does not plan tomorrow's returns.
        pickup_datetime: null,
        comment: comment.trim() || null,
      });
      // The order exists from here on. A refused assignment must not send him
      // back to a filled-in form to create a second one.
      if (driverId) {
        try {
          // Binding, like every booking from this board: no accept step on the phone.
          await api.post('/assignments', { order_id: order.id, driver_id: driverId, binding: true });
        } catch {
          return 'assign';
        }
      }
      return null;
    },
    onSuccess: (failed) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      if (failed === 'assign') setError(t('sellerBoard.vozvratAssignFailed'));
      else onCreated();
    },
    onError: (err: Error) =>
      setError(
        err.message === 'vozvrat_original_order_not_delivered'
          ? t('createVozvrat.errNotDelivered')
          : err.message === 'vozvrat_original_order_invalid'
            ? t('createVozvrat.errOriginalInvalid')
            : t('createVozvrat.errGeneric'),
      ),
  });

  const submit = () => {
    setAttempted(true);
    setError(null);
    if (!clientId || !placeId || createM.isPending) return;
    createM.mutate();
  };

  return (
    <div className="flex flex-col gap-3.5">
      {error && <ErrorLine msg={error} />}
      <Labeled
        label={t('createVozvrat.client')}
        error={attempted && !clientId ? t('common.requiredField') : undefined}
      >
        <ClientPicker
          id="vozvrat-client"
          value={clientId}
          onSelect={setClientId}
          onCreated={(c) => setClientId(c.id)}
        />
      </Labeled>

      {/* The address is the client's own; it is not restated here. Only its
          absence is worth a line, since the driver would have nowhere to go. */}
      {clientId && !addressesQ.isLoading && !collectFrom && (
        <div className="-mt-1 rounded-lg border border-hairline bg-panel2 px-3 py-2 text-xs">
          <span className="font-semibold text-[#f87171]">{t('createVozvrat.noClientAddress')}</span>
        </div>
      )}


      <Labeled
        label={t('createVozvrat.place')}
        error={attempted && !placeId ? t('common.requiredField') : undefined}
      >
        <Select
          value={placeId}
          onChange={setPlaceId}
          options={(placesQ.data ?? []).map((p) => ({ value: p.id, label: toward(p.name) }))}
        />
      </Labeled>

      {/* The lorry is the one this window was opened on; nothing to say or ask. */}

      <Labeled label={t('createVozvrat.comment')}>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-lg border border-hairline bg-panel2 px-3 py-2.5 text-sm text-paper placeholder:text-slate outline-none focus:border-brand"
          placeholder={t('createVozvrat.commentPlaceholder')}
        />
      </Labeled>

      <div className="mt-1 grid grid-cols-[1fr_auto] gap-2.5">
        <ActionBtn kind="brand" onClick={submit} disabled={createM.isPending}>
          {createM.isPending ? t('createVozvrat.creating') : t('createVozvrat.submit')}
        </ActionBtn>
        <ActionBtn kind="neutral" onClick={onCancel}>
          {t('createVozvrat.cancel')}
        </ActionBtn>
      </div>
    </div>
  );
}

function FilledSummary({ order }: { order: SellerOrder }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-hairline border-l-4 border-l-free bg-[#12181f] p-4 text-sm">
      <div className="mb-2 text-sm font-bold text-free">
        ✓ {t('sellerBoard.orderFilled', { client: clientNameOf(order, t('sellerBoard.otherClient')) })}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field k={t('sellerBoard.client')} v={clientNameOf(order, t('sellerBoard.otherClient'))} />
        <Field k={t('sellerBoard.cargo')} v={order.cargo_type_name} />
        <Field
          k={t('sellerBoard.weight')}
          v={order.weight_kg != null ? `${money(order.weight_kg)} kg` : null}
          mono
        />
        <Field k={t('sellerBoard.district')} v={order.district_name} />
      </div>
      <ExceptionReport order={order} />
    </div>
  );
}

function ExceptionReport({ order }: { order: SellerOrder }) {
  const { t } = useTranslation();
  if (!order.problem_reason) return null;
  const known = ORDER_EXCEPTION_REASONS.includes(
    order.problem_reason as OrderExceptionReason,
  );
  const reason = known
    ? t(`exceptionReason.${order.problem_reason as OrderExceptionReason}`)
    : order.problem_reason;
  return (
    <div className="mt-3 rounded-lg border border-[#eab308] bg-[#332a0d] px-3 py-2.5">
      <div className="text-xs font-extrabold text-[#facc15]">
        ! {t('sellerBoard.exceptionReported')}
      </div>
      <div className="mt-1 font-semibold text-paper">{reason}</div>
      {order.problem_comment ? (
        <div className="mt-1 text-xs text-slate-light">
          {t('sellerBoard.exceptionComment')}: {order.problem_comment}
        </div>
      ) : null}
    </div>
  );
}

// --- One order's fill form (the active slot) ---
interface Src {
  pickup_place_id: string;
}
function OrderForm({
  slot,
  vehicleCapacityKg,
  prefill,
  onFilled,
  onCancelled,
}: {
  slot: BookingSlot;
  vehicleCapacityKg: number | null;
  prefill?: Prefill;
  onFilled: (s: BookingSession) => void;
  onCancelled: () => void;
}) {
  const { t } = useTranslation();
  const deadline = slot.fill_deadline;
  const timer = useCountdown(deadline);
  const [clientId, setClientId] = useState(prefill?.clientId ?? '');
  // Which of the client's places this truck is booked to. Fetched here rather
  // than carried by the picker, so the picker stays a picker.
  const [addressId, setAddressId] = useState('');
  const addressesQ = useQuery({
    queryKey: ['client-addresses', clientId],
    queryFn: () => api.get<ClientAddressPublic[]>(`/clients/${clientId}/addresses`),
    enabled: !!clientId,
  });
  const addresses = (addressesQ.data ?? []).filter((a) => a.active);
  useEffect(() => {
    const fallback = addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? '';
    if (!addresses.some((a) => a.id === addressId)) setAddressId(fallback);
  }, [addresses, addressId]);
  const [cargoTypeId, setCargoTypeId] = useState('');
  const [weight, setWeight] = useState(prefill?.weight ?? '');
  const [sources, setSources] = useState<Src[]>(
    prefill?.pickupPlaceIds?.length
      ? prefill.pickupPlaceIds.map((id) => ({ pickup_place_id: id }))
      : [{ pickup_place_id: '' }],
  );
  const [creatingPlaceFor, setCreatingPlaceFor] = useState<number | null>(null);
  const [dims, setDims] = useState({ l: prefill?.length ?? '', w: '', h: '' });
  // With po puti allowed: how long his client may wait for it (owner, 10.11.2026).
  const [attested, setAttested] = useState(false);
  const [waybill, setWaybill] = useState<WaybillSource>('warehouse');
  const [poputiAllowed, setPoputiAllowed] = useState(false);
  const [comment, setComment] = useState('');
  const [attempted, setAttempted] = useState(false);
  const weightValue = weight.trim() ? Number(weight) : null;
  const weightInvalid = weightValue != null && (!Number.isInteger(weightValue) || weightValue <= 0);
  const weightOverLimit =
    weightValue != null && vehicleCapacityKg != null && weightValue > vehicleCapacityKg;
  // Po puti needs the weight on both sides (owner, 10.11.2026).
  const weightNeeded = (slot.is_backhaul || poputiAllowed) && weightValue == null;
  const weightError = weightOverLimit
    ? t('sellerBoard.weightOverLimit', { limit: vehicleCapacityKg })
    : attempted && weightInvalid
      ? t('sellerBoard.weightInvalid')
      : weightNeeded && (attempted || poputiAllowed)
        ? t('sellerBoard.weightRequiredPoputi')
        : undefined;

  const cargoQ = useQuery({
    queryKey: ['seller', 'cargo-types'],
    queryFn: () => api.get<CargoTypePublic[]>('/seller/cargo-types'),
  });
  const placesQ = useQuery({
    queryKey: ['pickup-places'],
    queryFn: () => api.get<PickupPlacePublic[]>('/pickup-places'),
  });

  // Timer ran out — the slot auto-cancels server-side; drop the session.
  useEffect(() => {
    if (deadline && timer.expired) onCancelled();
  }, [deadline, timer.expired, onCancelled]);

  const submitM = useMutation({
    mutationFn: () =>
      api.patch<BookingSession>(`/seller/reservations/${slot.reservation_id}/fill`, {
        client_id: clientId,
        client_address_id: addressId || null,
        cargo_type_id: cargoTypeId,
        weight_kg: weightValue,
        pickup_sources: sources
          .filter((s) => s.pickup_place_id)
          .map((s) => ({ pickup_place_id: s.pickup_place_id })),
        length_cm: dims.l ? Number(dims.l) : null,
        width_cm: dims.w ? Number(dims.w) : null,
        height_cm: dims.h ? Number(dims.h) : null,
        over_limit_attested: attested,
        waybill_source: WAYBILL_SOURCES[waybill],
        poputi_allowed: poputiAllowed,
        comment: comment || null,
        ...(slot.is_backhaul && prefill?.hostOrderId ? { poputi_host_order_id: prefill.hostOrderId } : {}),
      }),
    onSuccess: (s) => onFilled(s),
  });
  const cancelM = useMutation({
    mutationFn: () => api.del(`/seller/reservations/${slot.reservation_id}`),
    onSuccess: onCancelled,
  });

  const valid =
    clientId &&
    cargoTypeId &&
    !weightInvalid &&
    !weightOverLimit &&
    !weightNeeded &&
    sources.every((s) => s.pickup_place_id);

  return (
    <div>
      {submitM.isError && <ErrorLine msg={t('sellerBoard.errFill')} />}

      <div className="flex flex-col gap-3.5">
        <Labeled
          label={t('sellerBoard.client')}
          error={attempted && !clientId ? t('common.requiredField') : undefined}
        >
          <ClientPicker
            id="seller-order-client"
            value={clientId}
            onSelect={setClientId}
            onCreated={(c) => {
              void queryClient.invalidateQueries({ queryKey: ['clients'] });
              setClientId(c.id);
            }}
          />
          {addresses.length > 1 && (
            <select
              className="input mt-2"
              value={addressId}
              onChange={(e) => setAddressId(e.target.value)}
              aria-label={t('createOrder.deliveryAddress')}
            >
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {a.address ? ` — ${a.address}` : ''}
                </option>
              ))}
            </select>
          )}
        </Labeled>
        <Labeled label={t('sellerBoard.sources')}>
          <div className="flex flex-col gap-2">
            {sources.map((s, i) => (
              <div key={i} className="space-y-2">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  {/* Geo comes from the place itself — shown in the label, never re-picked. */}
                  <PickupPlacePicker
                    id={`seller-order-source-${i}`}
                    error={attempted && !s.pickup_place_id ? t('common.requiredField') : undefined}
                    value={s.pickup_place_id}
                    onSelect={(val) =>
                      setSources((p) =>
                        p.map((x, j) => (j === i ? { ...x, pickup_place_id: val } : x)),
                      )
                    }
                    places={placesQ.data ?? []}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCreatingPlaceFor(creatingPlaceFor === i ? null : i)}
                      className="rounded-lg border border-[#26344a] bg-[#182234] px-3 text-xs font-semibold text-brand hover:bg-panel2"
                    >
                      + {t('sellerBoard.addNewPlace')}
                    </button>
                    {sources.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSources((p) => p.filter((_, j) => j !== i));
                          setCreatingPlaceFor(null);
                        }}
                        className="rounded-lg border border-hairline bg-panel2 px-3 text-lg text-slate-light"
                      >
                        −
                      </button>
                    )}
                  </div>
                </div>
                {creatingPlaceFor === i && (
                  <PickupPlaceCreator
                    onCreated={(place) => {
                      setSources((current) =>
                        current.map((source, index) =>
                          index === i ? { ...source, pickup_place_id: place.id } : source,
                        ),
                      );
                      setCreatingPlaceFor(null);
                    }}
                    onCancel={() => setCreatingPlaceFor(null)}
                  />
                )}
              </div>
            ))}
            {sources.length < 10 && (
              <button
                type="button"
                onClick={() => setSources((p) => [...p, { pickup_place_id: '' }])}
                className="rounded-lg border border-[#26344a] bg-[#182234] py-2.5 text-sm font-semibold text-[#9db4d6]"
              >
                + {t('sellerBoard.addSource')}
              </button>
            )}
          </div>
        </Labeled>
        <Labeled label={t('sellerBoard.dims')}>
          <div className="grid grid-cols-3 gap-2.5">
            <Input
              value={dims.l}
              onChange={(v) => setDims((d) => ({ ...d, l: v }))}
              placeholder={t('sellerBoard.len')}
              type="number"
            />
            <Input
              value={dims.w}
              onChange={(v) => setDims((d) => ({ ...d, w: v }))}
              placeholder={t('sellerBoard.wid')}
              type="number"
            />
            <Input
              value={dims.h}
              onChange={(v) => setDims((d) => ({ ...d, h: v }))}
              placeholder={t('sellerBoard.hei')}
              type="number"
            />
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-light">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />{' '}
            {t('sellerBoard.overLimit')}
          </label>
        </Labeled>
        {/* What is being carried, and how much of it: one row, side by side. */}
        <div className="grid grid-cols-2 gap-3">
          <Labeled label={t('sellerBoard.cargo')}>
            <Select
              id="seller-order-cargo"
              error={attempted && !cargoTypeId ? t('common.requiredField') : undefined}
              value={cargoTypeId}
              onChange={setCargoTypeId}
              placeholder={t('sellerBoard.pickCargo')}
              options={(cargoQ.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Labeled>
          <Labeled label={t('sellerBoard.weightOptional')}>
            <Input
              id="seller-order-weight"
              value={weight}
              onChange={setWeight}
              placeholder="kg"
              type="number"
              error={weightError}
            />
          </Labeled>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label={t('sellerBoard.waybill')}>
            <Select
              value={waybill}
              onChange={(value) => setWaybill(value as WaybillSource)}
              options={[
                { value: 'warehouse', label: t('sellerBoard.waybillWarehouse') },
                { value: 'shop', label: t('sellerBoard.waybillShop') },
                { value: 'none', label: t('sellerBoard.waybillNone') },
                { value: 'supplier', label: t('sellerBoard.waybillSupplier') },
              ]}
            />
          </Labeled>
          {/* Riding po puti with another seller's order: not offered (owner, 09.11.2026). */}
          {!slot.is_backhaul && (
            <label className="mt-6 flex items-center gap-2 text-sm text-slate-light">
              <input
                type="checkbox"
                checked={poputiAllowed}
                onChange={(e) => setPoputiAllowed(e.target.checked)}
              />{' '}
              {t('sellerBoard.poputiOk')}
            </label>
          )}
        </div>
        <Labeled label={t('sellerBoard.comment')}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-hairline bg-panel2 px-3 py-2.5 text-sm text-paper placeholder:text-slate outline-none focus:border-brand"
            placeholder={t('sellerBoard.commentHint')}
          />
        </Labeled>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2.5">
        <ActionBtn
          kind="brand"
          disabled={submitM.isPending}
          onClick={() => {
            setAttempted(true);
            if (!valid) {
              let id: string;
              if (!clientId) id = 'seller-order-client';
              else if (!cargoTypeId) id = 'seller-order-cargo';
              else if (weightInvalid || weightOverLimit) id = 'seller-order-weight';
              else {
                const index = sources.findIndex((source) => !source.pickup_place_id);
                id = `seller-order-source-${index}`;
              }
              requestAnimationFrame(() => document.getElementById(id)?.focus());
              return;
            }
            submitM.mutate();
          }}
        >
          {t('sellerBoard.bandQilish')} ✓
        </ActionBtn>
        <ActionBtn kind="danger" onClick={() => cancelM.mutate()}>
          {t('sellerBoard.zakazOtmen')}
        </ActionBtn>
      </div>
    </div>
  );
}

// --- Pickup-place picker: type-to-filter existing places ---
function pickupPlaceLabel(place: PickupPlacePublic): string {
  return place.district_name ? `${place.name} · ${place.district_name}` : place.name;
}

const PLACE_ORDER: Record<PickupPlacePublic['type'], number> = { warehouse: 0, market: 1, custom: 2 };

function PickupPlacePicker({
  id,
  value,
  onSelect,
  places,
  error,
}: {
  id?: string;
  value: string;
  onSelect: (id: string) => void;
  places: PickupPlacePublic[];
  error?: string;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = places.find((place) => place.id === value) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase('uz');
  // The warehouse first, the shop next, the suppliers after: the two places
  // nearly every order starts from are always the first two on the list.
  const ordered = [...places].sort(
    (a, b) => PLACE_ORDER[a.type] - PLACE_ORDER[b.type] || a.name.localeCompare(b.name, 'uz'),
  );
  const filtered = normalizedQuery
    ? ordered.filter((place) =>
        [place.name, place.district_name, place.address]
          .filter(Boolean)
          .some((part) => part!.toLocaleLowerCase('uz').includes(normalizedQuery)),
      )
    : ordered;

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-invalid={!!error}
        // The same Chrome quirk as the client box: its own white history list
        // dropped over ours (owner, 03.11.2026), with places long deleted in it.
        autoComplete="one-time-code"
        className={`${inputCls} ${error ? 'border-[#dc2626]' : ''}`}
        placeholder={t('sellerBoard.typePlace')}
        value={selected && !open ? pickupPlaceLabel(selected) : query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (value) onSelect('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            setQuery('');
          }
        }}
      />
      {open && (
        <div
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-hairline bg-panel shadow-2xl"
        >
          {/* The names, and nothing else. Three places fit on the screen at
              once; headings over one row each were furniture. */}
          {filtered.map((place) => (
            <button
              key={place.id}
              type="button"
              role="option"
              aria-selected={place.id === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(place.id);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-panel2"
            >
              <span className="text-paper">{place.name}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3.5 py-2.5 text-sm text-slate-light">
              {t('sellerBoard.noPlaces')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Client picker: type-to-search existing clients + inline "add new client" ---
function ClientPicker({
  id,
  value,
  onSelect,
  onCreated,
}: {
  id?: string;
  value: string;
  onSelect: (id: string) => void;
  onCreated: (c: ClientPublic) => void;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  // Searched on the server. This used to pull every client in the database and
  // filter in the browser, which stops working as soon as the list is bounded.
  const debounced = useDebouncedValue(query, 250);
  const clientsQ = useQuery({
    queryKey: ['clients', 'search', debounced],
    queryFn: () =>
      api.get<ClientPublic[]>(
        `/clients?take=20${debounced.trim() ? `&search=${encodeURIComponent(debounced.trim())}` : ''}`,
      ),
    placeholderData: (prev) => prev,
  });
  const clients = clientsQ.data ?? [];
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [districtCode, setDistrictCode] = useState('');
  const [phone, setPhone] = useState(UZ_PHONE_PREFIX);
  const [pin, setPin] = useState<Coordinates | null>(null);
  // Off by default: most of what a seller types in here is a one-off — a
  // client or a supplier seen once — and an address book full of those is
  // worse than no address book.
  // Regular or one-off: asked the moment the name is typed, answered with one tap.
  const [clientKind, setClientKind] = useState<'regular' | 'one_off' | null>(null);
  // Filled by reverse geocoding when the pin lands. Sellers never typed an
  // address before; this gives their clients one without a new field to fill.
  const [resolvedAddress, setResolvedAddress] = useState('');
  const [createAttempted, setCreateAttempted] = useState(false);
  const autofill = useGeoAutofill({ regionCode, setRegion: setRegionCode, setDistrict: setDistrictCode });
  // The chosen client can fall outside the current search results, so keep the
  // last resolved one rather than losing the label.
  const [selected, setSelected] = useState<ClientPublic | null>(null);
  useEffect(() => {
    if (!value) setSelected(null);
    else {
      const hit = clients.find((c) => c.id === value);
      if (hit) setSelected(hit);
    }
  }, [value, clients]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        // Only the results list. The create form is in-flow now and holds a
        // map; dismissing it on a stray click would throw away the pin.
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = clients;

  const createM = useMutation({
    mutationFn: () =>
      api.post<ClientPublic>('/clients', {
        name: name.trim(),
        phone_number: normalizeUzPhoneNumber(phone),
        region_code: regionCode,
        district_code: districtCode || null,
        lat: pin?.lat,
        lng: pin?.lng,
        address: resolvedAddress || undefined,
        one_off: clientKind === 'one_off',
      }),
    onSuccess: (c) => {
      // A client kept in the directory must be in the list the moment it is
      // saved. Without this the next search answered from cache and the seller
      // concluded the tick had done nothing.
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      // A one-off client is not in the directory, so the search will never
      // return it; the box has to be told who was just chosen, or it stays
      // blank with the client saved behind it.
      setSelected(c);
      onCreated(c);
      setName('');
      setClientKind(null);
      setRegionCode('');
      setDistrictCode('');
      setPin(null);
      setResolvedAddress('');
      setPhone(UZ_PHONE_PREFIX);
      setCreateAttempted(false);
      setQuery('');
      setCreating(false);
      setOpen(false);
    },
  });
  // The pin is not part of this: a one-off client — somebody who orders once
  // and is never seen again — should not hold up the order while the seller
  // hunts for the place on a map. Without it the order has no ETA and the
  // driver gets no route, which is said under the picker.
  const createValid =
    name.trim() &&
    isCompleteUzPhoneNumber(phone) &&
    regionCode &&
    (!isCityRegionCode(regionCode) || districtCode);
  const createNameError =
    createAttempted && !name.trim() ? t('common.requiredField') : undefined;
  const createPhoneError =
    createAttempted && !isCompleteUzPhoneNumber(phone) ? t('sellerBoard.missingPhone') : undefined;
  const createRegionError =
    createAttempted && !regionCode ? t('common.requiredField') : undefined;
  const createDistrictError =
    createAttempted && isCityRegionCode(regionCode) && !districtCode
      ? t('common.requiredField')
      : undefined;
  // Said beside the button, in words. A red border on a select further up the
  // form was the only sign before, and "I pressed save and nothing happened"
  // is exactly what that looks like from the other side of the screen.
  const createBlockedBy = !createAttempted
    ? null
    : !clientKind
      ? t('sellerBoard.missingKind')
      : !name.trim()
        ? t('sellerBoard.missingName')
      : !regionCode
        ? t('sellerBoard.missingRegion')
        : isCityRegionCode(regionCode) && !districtCode
          ? t('sellerBoard.missingDistrict')
          : !isCompleteUzPhoneNumber(phone)
            ? t('sellerBoard.missingPhone')
            : null;
  const createServerError = createM.isError
    ? createM.error instanceof ApiError && createM.error.status === 400
      ? t('sellerBoard.errCreateClientInvalid')
      : t('sellerBoard.errCreateClient')
    : null;

  return (
    <div className="relative" ref={boxRef}>
      <input
        id={id}
        className={inputCls}
        // Chrome keeps a list of everything ever typed here and drops it over
        // our own list in white — two names in two lists, and the seller picks
        // the wrong one. A combobox role with a one-time-code hint is what
        // Chrome actually honours; plain autocomplete="off" it does not.
        autoComplete="one-time-code"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        placeholder={t('sellerBoard.typeClient')}
        value={selected && !open ? selected.name : query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onSelect('');
        }}
      />
      {open && !creating && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-hairline bg-panel shadow-2xl">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(c.id);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-panel2"
            >
              <span className="text-paper">{c.name}</span>
              <span className="font-mono text-xs text-slate-light">{c.phone_number}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3.5 py-2.5 text-sm text-slate-light">
              {t('sellerBoard.noClients')}
            </div>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setCreating(true);
              setOpen(false);
            }}
            className="w-full border-t border-hairline px-3.5 py-2.5 text-left text-sm font-semibold text-brand hover:bg-panel2"
          >
            + {t('sellerBoard.addNewClient')}
          </button>
        </div>
      )}
      {creating && (
        // In-flow (not a floating dropdown): the map needs room, and Leaflet
        // misbehaves inside absolutely positioned, scrolling containers.
        <div className="mt-2 w-full rounded-xl border border-hairline bg-panel p-3">
          <div className="flex flex-col gap-2">
            {/* The first question, before a single letter is typed: is this a
                regular client or a one-off? The rest of the form waits for
                the answer. */}
            {!clientKind && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-light">{t('sellerBoard.clientKindAsk')}</span>
              <div className="grid grid-cols-2 gap-2">
              {(['regular', 'one_off'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setClientKind(k)}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    clientKind === k
                      ? 'border-brand bg-brand/15 text-brand'
                      : 'border-hairline bg-panel2 text-paper hover:border-brand/60'
                  }`}
                >
                  {t(k === 'regular' ? 'sellerBoard.clientRegular' : 'sellerBoard.clientOneOff')}
                </button>
              ))}
              </div>
            </div>
            )}
            {clientKind && (<>
            {/* The answer, once given, sits as a small chip so a wrong tap can be undone. */}
            <button
              type="button"
              onClick={() => setClientKind(null)}
              className="self-start rounded-full border border-brand/50 bg-brand/15 px-3 py-1 text-xs font-semibold text-brand"
            >
              {t(clientKind === 'regular' ? 'sellerBoard.clientRegular' : 'sellerBoard.clientOneOff')} ✕
            </button>
            <input
              id="seller-new-client-name"
              className={`${inputCls} ${createNameError ? 'border-[#dc2626]' : ''}`}
              placeholder={t('sellerBoard.clientName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!createNameError}
              // The browser was offering every name ever typed in this box as
              // a suggestion. A new client is new; nothing should be guessed —
              // and "off" alone Chrome ignores, "one-time-code" it honours.
              autoComplete="one-time-code"
              autoFocus
            />
            {createNameError && (
              <p role="alert" className="text-xs font-medium text-[#ef4444]">{createNameError}</p>
            )}
            <div>
              <UzPhoneInput
                id="seller-new-client-phone"
                className={`${inputCls} ${createPhoneError ? 'border-[#dc2626]' : ''}`}
                value={phone}
                onChange={setPhone}
                aria-invalid={!!createPhoneError}
                autoComplete="off"
              />
              {createPhoneError && (
                <p role="alert" className="mt-1 text-xs font-medium text-[#ef4444]">{createPhoneError}</p>
              )}
            </div>
            <ClientGeoFields
              regionCode={regionCode}
              districtCode={districtCode}
              onRegion={setRegionCode}
              onDistrict={setDistrictCode}
              wrapperClassName="space-y-2"
              labelClassName="mb-1 block text-[11px] uppercase tracking-wide text-slate-light"
              selectClassName={inputCls}
              regionId="seller-new-client-region"
              districtId="seller-new-client-district"
              regionError={createRegionError}
              districtError={createDistrictError}
              // No map here. The client sends their position over Telegram
              // and the seller pastes that link: the pin, the address and the
              // tuman all come out of it, and a map he never touched was only
              // pushing the phone field off the screen. The link comes first:
              // it is what fills viloyat and tuman, and the seller watches them
              // fill in under it.
              before={
                <LocationPickerLazy
                  value={pin}
                  regionCode={regionCode}
                  districtCode={districtCode}
                  theme="dark"
                  showMap={false}
                  onChange={setPin}
                  onAddress={setResolvedAddress}
                  onResolved={(r) => void autofill(r)}
                  inputId="seller-new-client-location"
                />
              }
            />
            {resolvedAddress && (
              <p className="text-xs text-slate-light">
                <span className="font-semibold uppercase tracking-wide">{t('locationPicker.resolvedAddress')}:</span>{' '}
                <span className="text-paper">{resolvedAddress}</span>
              </p>
            )}
            </>)}
            {createBlockedBy && <ErrorLine msg={createBlockedBy} />}
            {createServerError && <ErrorLine msg={createServerError} />}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <ActionBtn
                kind="brand"
                disabled={createM.isPending || !clientKind}
                onClick={() => {
                  setCreateAttempted(true);
                  if (!createValid) {
                    const targetId = !name.trim()
                      ? 'seller-new-client-name'
                      : !regionCode
                        ? 'seller-new-client-region'
                        : isCityRegionCode(regionCode) && !districtCode
                          ? 'seller-new-client-district'
                          : !pin
                            ? 'seller-new-client-location'
                            : 'seller-new-client-phone';
                    requestAnimationFrame(() => document.getElementById(targetId)?.focus());
                    return;
                  }
                  createM.mutate();
                }}
              >
                {t('sellerBoard.addClient')}
              </ActionBtn>
              <ActionBtn
                kind="neutral"
                onClick={() => {
                  setCreating(false);
                  setCreateAttempted(false);
                  setClientKind(null);
                }}
              >
                {t('sellerBoard.bekor')}
              </ActionBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- small dark UI primitives ---
function VehicleInfo({ vehicle, status }: { vehicle: BoardVehicle; status: string }) {
  const { t } = useTranslation();
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.free;
  return (
    <div
      className={`mb-3.5 rounded-xl border border-l-4 border-hairline bg-[#12181f] p-3.5 ${st.border}`}
    >
      <div className="grid grid-cols-3 gap-2.5">
        <Field k={t('sellerBoard.vehicle')} v={`${vehicle.model} · ${t(`vehicleCategory.${vehicle.category}`)}`} />
        <Field k={t('sellerBoard.plate')} v={vehicle.plate_number} mono />
        <Field k={t('sellerBoard.driver')} v={vehicle.driver_name} />
      </div>
    </div>
  );
}
function Field({ k, v, mono }: { k: string; v: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate">{k}</div>
      <div className={`mt-0.5 text-sm font-semibold ${mono ? 'font-mono' : ''}`}>{v ?? '—'}</div>
    </div>
  );
}
function Input({
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  error,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  error?: string;
}) {
  return (
    <>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        className={`w-full rounded-lg border bg-panel2 px-3 py-2.5 text-sm text-paper placeholder:text-slate outline-none focus:border-brand ${error ? 'border-[#dc2626]' : 'border-hairline'}`}
        aria-invalid={!!error}
      />
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-[#ef4444]">{error}</p>
      )}
    </>
  );
}
function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  error,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full rounded-lg border bg-panel2 px-3 py-2.5 text-sm text-paper outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-50 ${error ? 'border-[#dc2626]' : 'border-hairline'}`}
        aria-invalid={!!error}
      >
        {/* Without a prompt the empty state still needs somewhere to sit, but
            it is not one of the answers, so it is kept out of the list. */}
        {placeholder ? <option value="">{placeholder}</option> : <option value="" hidden />}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-[#ef4444]">{error}</p>
      )}
    </>
  );
}
