import type { Monitor, MonitorInput, Status } from '../shared/types';

/** '200-399' | '200,204' | '200-299,301' */
export const statusMatches = (code: number, spec: string) =>
  spec.split(',').some((part) => {
    const [lo, hi = lo] = part.split('-').map(Number);
    return code >= lo && code <= hi;
  });

const formatters = new Map<string, Intl.DateTimeFormat>();
const toMinutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

/** Is `now` inside [from, to) in the given timezone? Supports overnight windows (22:00–06:00). */
export function inWindow(from: string | null, to: string | null, now: number, tz: string) {
  if (!from || !to) return true;
  let f = formatters.get(tz);
  if (!f) formatters.set(tz, (f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })));
  const t = toMinutes(f.format(now));
  const a = toMinutes(from);
  const b = toMinutes(to);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

/** Next state of a monitor after one check. */
export function evaluate(m: Pick<Monitor, 'status' | 'fails' | 'fail_threshold' | 'interval_min'>, ok: boolean, tickAt: number) {
  const fails = ok ? 0 : m.fails + 1;
  const status: Status = ok ? 'up' : fails >= m.fail_threshold ? 'down' : m.status;
  // alert on up↔down and pending→down; a fresh monitor coming up is not news
  const alert = status !== m.status && !(m.status === 'pending' && status === 'up');
  // unconfirmed failure → re-check next minute; 30 s slack keeps it aligned with the cron
  const waitMin = !ok && status !== 'down' ? 1 : m.interval_min;
  return { fails, status, alert, next: tickAt + waitMin * 60_000 - 30_000 };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUS_SPEC = /^\d{3}(-\d{3})?(,\d{3}(-\d{3})?)*$/;
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Validates dashboard input. Returns the clean value or an error message. */
export function parseMonitor(b: any): MonitorInput | string {
  if (typeof b?.name !== 'string' || !b.name.trim() || b.name.length > 80) return 'Name is required (max 80 chars)';
  let url: URL;
  try { url = new URL(b.url); } catch { return 'Invalid URL'; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'URL must be http(s)';
  if (b.method !== 'GET' && b.method !== 'HEAD') return 'Method must be GET or HEAD';
  if (!int(b.interval_min, 1, 1440)) return 'Interval must be 1–1440 minutes';
  if (!int(b.timeout_sec, 5, 90)) return 'Timeout must be 5–90 seconds';
  if (typeof b.expected_status !== 'string' || !STATUS_SPEC.test(b.expected_status)) return 'Expected status like 200-399 or 200,204';
  const keyword = typeof b.keyword === 'string' && b.keyword.trim() ? b.keyword.trim().slice(0, 200) : null;
  if (keyword && b.method === 'HEAD') return 'Keyword check needs GET';
  const active_from = b.active_from || null;
  const active_to = b.active_to || null;
  if ((active_from || active_to) && !(HHMM.test(active_from) && HHMM.test(active_to) && active_from !== active_to))
    return 'Active hours need two different HH:MM times';
  if (!int(b.fail_threshold, 1, 10)) return 'Fail threshold must be 1–10';
  return {
    name: b.name.trim(), url: url.href, method: b.method, interval_min: b.interval_min, timeout_sec: b.timeout_sec,
    expected_status: b.expected_status, keyword, active_from, active_to, fail_threshold: b.fail_threshold,
    enabled: b.enabled === 0 || b.enabled === false ? 0 : 1,
  };
}
