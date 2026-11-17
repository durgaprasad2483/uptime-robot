import { useCallback, useEffect, useMemo, useState } from 'react';
import { HOUR, type Incident, type Monitor, type StatRow } from '../shared/types';
import { api } from './api';
import { MonitorForm } from './MonitorForm';
import { ago, Bars, Chart, Dot, pct } from './ui';

const hourLabel = (h: number) => new Date(h * HOUR).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function App() {
  const [data, setData] = useState<{ monitors: Monitor[]; stats: StatRow[] }>();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Monitor | null>();
  const [openId, setOpenId] = useState<number>();

  const load = useCallback(() => api<typeof data>('/monitors').then((d) => { setData(d); setError(''); }, (e) => setError(e.message)), []);
  useEffect(() => {
    load();
    const refresh = () => document.visibilityState === 'visible' && load();
    const t = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);

  const byMonitor = useMemo(() => {
    const map = new Map<number, Map<number, StatRow>>();
    for (const s of data?.stats ?? []) (map.get(s.monitor_id) ?? map.set(s.monitor_id, new Map()).get(s.monitor_id)!).set(s.hour, s);
    return map;
  }, [data]);

  const monitors = data?.monitors ?? [];
  const down = monitors.filter((m) => m.enabled && m.status === 'down').length;
  const nowHour = Math.floor(Date.now() / HOUR);

  async function act(fn: () => Promise<unknown>) {
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">Pulse</h1>
        {data && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${down ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'}`}>
            {down ? `${down} down` : 'All systems up'}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn" onClick={() => act(async () => { const r = await api<{ channels: number; delivered: number }>('/alerts/test', 'POST'); alert(r.channels ? `Delivered to ${r.delivered}/${r.channels} channel(s)` : 'No alert channel configured. Set TELEGRAM_* or NTFY_TOPIC secrets.'); })}>Test alert</button>
          <button className="btn btn-primary" onClick={() => setEditing(null)}>+ Add monitor</button>
        </div>
      </header>

      {error && <p className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {data && !monitors.length && <p className="py-16 text-center text-zinc-500">No monitors yet. Add the URL of an app you want to keep awake.</p>}

      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {monitors.map((m) => {
          const hours = Array.from({ length: 24 }, (_, i) => byMonitor.get(m.id)?.get(nowHour - 23 + i) ?? null);
          const n = hours.reduce((a, h) => a + (h?.n ?? 0), 0);
          const up = hours.reduce((a, h) => a + (h?.up ?? 0), 0);
          return (
            <li key={m.id}>
              <div className="grid cursor-pointer gap-x-4 gap-y-2 p-4 hover:bg-zinc-50 sm:grid-cols-[1fr_12rem_auto] dark:hover:bg-zinc-800/50" onClick={() => setOpenId(openId === m.id ? undefined : m.id)}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium"><Dot status={m.status} enabled={m.enabled} /><span className="truncate">{m.name}</span></div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">
                    {m.url.replace(/^https?:\/\//, '')} · every {m.interval_min} min{m.active_from ? ` · ${m.active_from}–${m.active_to}` : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {!m.enabled ? 'Paused' : m.status === 'pending' ? 'Waiting for first check' : `${m.status === 'up' ? 'Up' : 'Down'} ${ago(m.since).replace(' ago', '')}`}
                    {m.last_checked_at ? ` · checked ${ago(m.last_checked_at)}` : ''}
                    {m.status === 'down' && m.last_error ? <span className="text-red-600"> · {m.last_error}</span> : null}
                  </div>
                </div>
                <div className="self-center">
                  <Bars buckets={hours} label={(i) => hourLabel(nowHour - 23 + i)} />
                  <div className="mt-1 flex justify-between text-[11px] text-zinc-500"><span>24 h · {pct(up, n)}</span><span>{m.last_ms != null ? `${m.last_ms} ms` : ''}</span></div>
                </div>
                <div className="flex items-center gap-1.5 self-center" onClick={(e) => e.stopPropagation()}>
                  <button className="btn" title="Check now" onClick={() => act(() => api(`/monitors/${m.id}/check`, 'POST'))}>↻</button>
                  <button className="btn" title={m.enabled ? 'Pause' : 'Resume'} onClick={() => act(() => api(`/monitors/${m.id}`, 'PUT', { ...m, enabled: m.enabled ? 0 : 1 }))}>{m.enabled ? '❚❚' : '▶'}</button>
                  <button className="btn" onClick={() => setEditing(m)}>Edit</button>
                </div>
              </div>
              {openId === m.id && <Detail monitor={m} onDelete={() => act(() => api(`/monitors/${m.id}`, 'DELETE'))} />}
            </li>
          );
        })}
      </ul>

      <footer className="mt-6 flex justify-between text-xs text-zinc-500">
        <span>Refreshes every minute</span>
        <a href="/cdn-cgi/access/logout" className="hover:underline">Log out</a>
      </footer>

      {editing !== undefined && <MonitorForm monitor={editing} onClose={(changed) => { setEditing(undefined); if (changed) { load(); setTimeout(load, 5000); } }} />}
    </div>
  );
}

function Detail({ monitor, onDelete }: { monitor: Monitor; onDelete: () => void }) {
  const [h, setH] = useState<{ stats: StatRow[]; incidents: Incident[] }>();
  useEffect(() => { api<typeof h>(`/monitors/${monitor.id}/history`).then(setH); }, [monitor.id, monitor.last_checked_at]);
  if (!h) return <div className="px-4 pb-4 text-sm text-zinc-500">Loading…</div>;

  const nowHour = Math.floor(Date.now() / HOUR);
  const byHour = new Map(h.stats.map((s) => [s.hour, s]));
  const week = Array.from({ length: 168 }, (_, i) => { const s = byHour.get(nowHour - 167 + i); return s?.up ? Math.round(s.sum_ms / s.up) : null; });
  const days = Array.from({ length: 30 }, (_, d) => {
    let n = 0, up = 0;
    for (let k = 0; k < 24; k++) { const s = byHour.get(nowHour - 719 + d * 24 + k); n += s?.n ?? 0; up += s?.up ?? 0; }
    return n ? { n, up } : null;
  });
  const total = days.reduce<{ n: number; up: number }>((a, d) => ({ n: a.n + (d?.n ?? 0), up: a.up + (d?.up ?? 0) }), { n: 0, up: 0 });

  return (
    <div className="grid gap-5 border-t border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-950/30">
      <section>
        <h3 className="label">Response time, last 7 days (hourly avg)</h3>
        <Chart points={week} />
      </section>
      <section>
        <h3 className="label">Uptime, last 30 days · {pct(total.up, total.n)}</h3>
        <Bars buckets={days} label={(d) => new Date((nowHour - 719 + d * 24) * HOUR).toLocaleDateString()} />
      </section>
      <section>
        <h3 className="label">Incidents</h3>
        {h.incidents.length ? (
          <ul className="grid gap-1 text-sm">
            {h.incidents.map((i) => (
              <li key={i.id} className="flex flex-wrap gap-x-3">
                <span className={i.resolved_at ? 'text-zinc-500' : 'font-medium text-red-600'}>{i.resolved_at ? 'Resolved' : 'Ongoing'}</span>
                <span>{new Date(i.started_at).toLocaleString()}</span>
                <span className="text-zinc-500">{i.resolved_at ? `lasted ${ago(i.started_at, i.resolved_at).replace(' ago', '')}` : ''} {i.cause}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-zinc-500">None in the last 30 days 🎉</p>}
      </section>
      <button className="btn w-fit text-red-600" onClick={() => confirm(`Delete "${monitor.name}" and its history?`) && onDelete()}>Delete monitor</button>
    </div>
  );
}
