import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DriverPublic, DriverTrack } from '@bigant/shared';
import { api } from '../lib/api';
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { TrackMap } from '../components/TrackMap';
import { TZ, tkYmd } from '../lib/tashkent';

function today(): string {
  const d = new Date();
  return tkYmd(d);
}
const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—';

/** Where a truck went on a day: pick the driver and the date, see the trail. */
/** `embedded`: shown as a tab of Haydovchilar, which carries the heading. */
export function DriverTrackPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const driverId = params.get('driver') ?? '';
  const [date, setDate] = useState(params.get('date') ?? today());

  const drivers = useQuery({
    queryKey: ['drivers', 'all'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
  });
  const track = useQuery({
    queryKey: ['track', driverId, date],
    queryFn: () => api.get<DriverTrack>(`/analytics/drivers/${driverId}/track?date=${date}`),
    enabled: !!driverId && !!date,
  });

  // The tab this page sits in (?bolim=track) must survive picking a driver or a day.
  const keep = params.get('bolim');
  const withTab = (q: Record<string, string>) => (keep ? { bolim: keep, ...q } : q);
  const pick = (id: string) => setParams(withTab(id ? { driver: id, date } : {}), { replace: true });
  const data = track.data;
  const hasPoints = !!data && data.points.length > 0;

  return (
    <div>
      {!embedded && <PageHeader title={t('track.title')} subtitle={t('track.subtitle')} />}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="track-driver">
              {t('track.driver')}
            </label>
            <select id="track-driver" className="input" value={driverId} onChange={(e) => pick(e.target.value)}>
              <option value="">{t('track.chooseDriver')}</option>
              {(drivers.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.vehicle_plate ? ` · ${d.vehicle_plate}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="track-date">
              {t('track.date')}
            </label>
            <input
              id="track-date"
              type="date"
              className="input"
              value={date}
              max={today()}
              onChange={(e) => {
                setDate(e.target.value);
                if (driverId) setParams(withTab({ driver: driverId, date: e.target.value }), { replace: true });
              }}
            />
          </div>
        </div>
      </Card>

      {!driverId ? (
        <Card>
          <EmptyState title={t('track.chooseDriver')} />
        </Card>
      ) : track.isLoading ? (
        <Card>
          <Spinner />
        </Card>
      ) : !hasPoints ? (
        <Card>
          <EmptyState title={t('track.noData')} hint={t('track.noDataHint')} />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: t('track.distance'), value: `${data.distance_km} km`, fg: '#b94e06' },
              { label: t('track.firstFix'), value: hhmm(data.first_at), fg: '#15803d' },
              { label: t('track.lastFix'), value: hhmm(data.last_at), fg: '#1d4ed8' },
              { label: t('track.points'), value: String(data.points.length), fg: '#5b6470' },
            ].map((tile) => (
              <Card key={tile.label} className="p-5">
                <div className="font-mono text-2xl font-semibold" style={{ color: tile.fg }}>
                  {tile.value}
                </div>
                <div className="mt-1 text-sm text-slate">{tile.label}</div>
              </Card>
            ))}
          </div>
          <TrackMap points={data.points} startLabel={`${t('track.start')} ${hhmm(data.first_at)}`} endLabel={`${t('track.end')} ${hhmm(data.last_at)}`} />
          {data.stops.length > 0 && (
            <Card className="mt-4 p-5">
              <div className="mb-2 text-sm font-semibold text-ink">{t('track.stops')}</div>
              {data.stops.map((stop) => (
                <div key={stop.at} className="flex justify-between border-t border-mist py-2 text-sm">
                  <span className="font-mono text-slate">
                    {hhmm(stop.at)} – {hhmm(stop.until)}
                  </span>
                  <span className="font-semibold">{t('track.stopMinutes', { m: stop.minutes })}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
