import type { StatRow, Status } from '../shared/types';

export function ago(ts: number | null, now = Date.now()) {
  if (!ts) return '—';
  const s = Math.round(Math.abs(now - ts) / 1000);
  const v = s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`;
  return ts > now ? `in ${v}` : `${v} ago`;
}

export const pct = (up: number, n: number) => (n ? `${((up / n) * 100).toFixed(up === n ? 0 : 2)}%` : '—');

export function Dot({ status, enabled }: { status: Status; enabled: number }) {
  const c = !enabled ? 'bg-zinc-400' : status === 'up' ? 'bg-green-500' : status === 'down' ? 'bg-red-500' : 'bg-amber-400';
  return (
    <span className="relative flex size-2.5 shrink-0">
      {enabled && status === 'down' ? <span className={`absolute inline-flex size-full animate-ping rounded-full ${c} opacity-75`} /> : null}
      <span className={`relative inline-flex size-2.5 rounded-full ${c}`} />
    </span>
  );
}

/** One bar per bucket, coloured by uptime ratio. `null` = no data. */
export function Bars({ buckets, label }: { buckets: (Pick<StatRow, 'n' | 'up'> | null)[]; label: (i: number) => string }) {
  return (
    <div className="flex h-6 items-end gap-px">
      {buckets.map((b, i) => {
        const r = b && b.n ? b.up / b.n : -1;
        const c = r < 0 ? 'bg-zinc-200 dark:bg-zinc-800' : r === 1 ? 'bg-green-500' : r >= 0.5 ? 'bg-amber-400' : 'bg-red-500';
        return <div key={i} title={`${label(i)} · ${b ? pct(b.up, b.n) : 'no data'}`} className={`h-full flex-1 rounded-[1px] ${c}`} />;
      })}
    </div>
  );
}

/** Response-time line chart (avg ms per bucket). */
export function Chart({ points }: { points: (number | null)[] }) {
  const vals = points.filter((p): p is number => p != null);
  if (!vals.length) return <p className="py-8 text-center text-sm text-zinc-500">No successful checks yet</p>;
  const max = Math.max(...vals);
  const W = 600, H = 120;
  const path = points
    .map((p, i) => (p == null ? null : `${((i / Math.max(points.length - 1, 1)) * W).toFixed(1)},${(H - (p / max) * (H - 8)).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full overflow-visible">
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="text-sky-500" />
      </svg>
      <span className="absolute top-0 left-0 text-[10px] text-zinc-500">{max} ms</span>
      <span className="absolute right-0 bottom-0 text-[10px] text-zinc-500">avg {Math.round(vals.reduce((a, b) => a + b) / vals.length)} ms</span>
    </div>
  );
}
