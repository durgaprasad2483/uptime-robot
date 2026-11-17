import { useEffect, useRef, useState } from 'react';
import type { Monitor, MonitorInput } from '../shared/types';
import { api } from './api';

const PRESETS = {
  'Render backend (sleeps after 15 min)': { interval_min: 10, timeout_sec: 90, fail_threshold: 2 },
  'Koyeb backend (sleeps after 1 h)': { interval_min: 30, timeout_sec: 90, fail_threshold: 2 },
  'Supabase / Atlas (pauses after days idle)': { interval_min: 1440, timeout_sec: 60, fail_threshold: 1 },
  'Website, downtime alerts only': { interval_min: 5, timeout_sec: 30, fail_threshold: 2 },
} as const;

const EMPTY: MonitorInput = {
  name: '', url: '', method: 'GET', ...PRESETS['Render backend (sleeps after 15 min)'], expected_status: '200-399',
  keyword: null, active_from: null, active_to: null, enabled: 1, notify_every: 1,
};

function awakeHoursPerMonth(f: MonitorInput) {
  if (f.interval_min >= 15) return 0;
  if (!f.active_from || !f.active_to) return 730;
  const [a, b] = [f.active_from, f.active_to].map((t) => +t.slice(0, 2) * 60 + +t.slice(3));
  return Math.round((((b - a + 1440) % 1440) / 60) * 30.4);
}

export function MonitorForm({ monitor, onClose }: { monitor: Monitor | null; onClose: (changed: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<MonitorInput>(monitor ?? EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof MonitorInput>(k: K, v: MonitorInput[K]) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => ref.current?.showModal(), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await (monitor ? api(`/monitors/${monitor.id}`, 'PUT', f) : api('/monitors', 'POST', f));
      onClose(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const hours = awakeHoursPerMonth(f);
  return (
    <dialog ref={ref} onClose={() => onClose(false)} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/50 dark:bg-zinc-900 dark:text-zinc-100">
      <form onSubmit={submit} className="grid gap-4 p-5">
        <h2 className="text-lg font-semibold">{monitor ? 'Edit monitor' : 'New monitor'}</h2>

        <label><span className="label">Preset</span>
          <select className="input" defaultValue="" onChange={(e) => e.target.value && setF((p) => ({ ...p, ...PRESETS[e.target.value as keyof typeof PRESETS] }))}>
            <option value="">Choose to fill interval &amp; timeout…</option>
            {Object.keys(PRESETS).map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <label><span className="label">Name</span><input className="input" required maxLength={80} value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label><span className="label">URL</span><input className="input" required type="url" placeholder="https://my-api.onrender.com/health" value={f.url} onChange={(e) => set('url', e.target.value)} /></label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label><span className="label">Every (min)</span><input className="input" type="number" min={1} max={1440} required value={f.interval_min} onChange={(e) => set('interval_min', +e.target.value)} /></label>
          <label><span className="label">Timeout (s)</span><input className="input" type="number" min={5} max={90} required value={f.timeout_sec} onChange={(e) => set('timeout_sec', +e.target.value)} /></label>
          <label><span className="label">Fails before down</span><input className="input" type="number" min={1} max={10} required value={f.fail_threshold} onChange={(e) => set('fail_threshold', +e.target.value)} /></label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label><span className="label">Active from (blank = 24/7)</span><input className="input" type="time" value={f.active_from ?? ''} onChange={(e) => set('active_from', e.target.value || null)} /></label>
          <label><span className="label">Active until</span><input className="input" type="time" value={f.active_to ?? ''} onChange={(e) => set('active_to', e.target.value || null)} /></label>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">Advanced</summary>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <label><span className="label">Method</span>
              <select className="input" value={f.method} onChange={(e) => set('method', e.target.value as 'GET' | 'HEAD')}><option>GET</option><option>HEAD</option></select>
            </label>
            <label><span className="label">Expected status</span><input className="input" required pattern="\d{3}(-\d{3})?(,\d{3}(-\d{3})?)*" value={f.expected_status} onChange={(e) => set('expected_status', e.target.value)} /></label>
            <label><span className="label">Body contains</span><input className="input" maxLength={200} value={f.keyword ?? ''} onChange={(e) => set('keyword', e.target.value || null)} /></label>
          </div>
        </details>

        {hours > 0 && (
          <p className={`rounded-md p-2.5 text-xs ${hours > 375 ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
            On Render this keeps the service awake ≈ <b>{hours} h/month</b>. A free workspace has <b>750 h</b> shared by all its services. When they run out, all of them are suspended.
            {!f.active_from && ' Set active hours to use less.'}
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <div className="grid gap-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.enabled} onChange={(e) => set('enabled', e.target.checked ? 1 : 0)} />Enabled</label>
            <label className="flex items-center gap-2" title="Down/up alerts are always sent, with sound"><input type="checkbox" checked={!!f.notify_every} onChange={(e) => set('notify_every', e.target.checked ? 1 : 0)} />Message me after every check (silent)</label>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
