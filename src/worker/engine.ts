import { HOUR, type Monitor } from '../shared/types';
import { evaluate, inWindow, statusMatches } from './logic';

const MAX_PER_TICK = 35; // free plan: 50 subrequests per invocation (fetches + D1 + alerts)
const CONCURRENCY = 6;   // free plan: 6 simultaneous outgoing connections

interface Result { ok: boolean; code: number | null; ms: number; error: string | null }

async function probe(m: Monitor): Promise<Result> {
  const start = Date.now();
  try {
    const res = await fetch(m.url, {
      method: m.method,
      headers: { 'user-agent': 'PulseKeepAlive/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(m.timeout_sec * 1000),
    });
    const ms = Date.now() - start;
    if (!statusMatches(res.status, m.expected_status)) {
      await res.body?.cancel();
      return { ok: false, code: res.status, ms, error: `HTTP ${res.status}` };
    }
    if (m.keyword) {
      if (!(await res.text()).includes(m.keyword)) return { ok: false, code: res.status, ms, error: `Keyword "${m.keyword}" not found` };
    } else await res.body?.cancel();
    return { ok: true, code: res.status, ms, error: null };
  } catch (e) {
    const err = e as Error;
    return { ok: false, code: null, ms: Date.now() - start, error: err.name === 'TimeoutError' ? `Timeout after ${m.timeout_sec}s` : err.message };
  }
}

const mins = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

/** Probe monitors, persist everything in one D1 batch, send one combined alert. */
export async function checkAndSave(env: Env, list: Monitor[], now = Date.now()) {
  const results: Result[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
      while (next < list.length) { const i = next++; results[i] = await probe(list[i]); }
    }),
  );

  const db = env.DB;
  const update = db.prepare('UPDATE monitors SET status=?, since=?, fails=?, last_checked_at=?, last_ms=?, last_code=?, last_error=?, next_check_at=? WHERE id=?');
  const stat = db.prepare(`INSERT INTO stats (monitor_id, hour, n, up, sum_ms, max_ms) VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT DO UPDATE SET n = n + 1, up = up + excluded.up, sum_ms = sum_ms + excluded.sum_ms, max_ms = max(max_ms, excluded.max_ms)`);
  const open = db.prepare('INSERT INTO incidents (monitor_id, started_at, cause) VALUES (?, ?, ?)');
  const close = db.prepare('UPDATE incidents SET resolved_at=? WHERE monitor_id=? AND resolved_at IS NULL');
  const hour = Math.floor(now / HOUR);
  const stmts: D1PreparedStatement[] = [];
  const alerts: string[] = [];

  list.forEach((m, i) => {
    const r = results[i];
    const e = evaluate(m, r.ok, now);
    const changed = e.status !== m.status;
    const okMs = r.ok ? r.ms : 0;
    stmts.push(
      update.bind(e.status, changed ? now : m.since, e.fails, now, r.ms, r.code, r.error, e.next, m.id),
      stat.bind(m.id, hour, r.ok ? 1 : 0, okMs, okMs),
    );
    if (changed && e.status === 'down') stmts.push(open.bind(m.id, now, r.error));
    if (changed && m.status === 'down') stmts.push(close.bind(now, m.id));
    if (e.alert)
      alerts.push(e.status === 'down'
        ? `🔴 ${m.name} is DOWN — ${r.error}\n${m.url}`
        : `🟢 ${m.name} is UP (${r.ms} ms)${m.since ? ` after ${mins(now - m.since)}` : ''}`);
  });

  if (stmts.length) await db.batch(stmts);
  if (alerts.length) await notify(env, alerts.join('\n\n'));
}

/** Cron entry: runs every minute. A one-row lock prevents overlapping runs. */
export async function tick(env: Env, now = Date.now()) {
  const lock = await env.DB.prepare('UPDATE tick SET lock_until=? WHERE id=1 AND lock_until<?').bind(now + 180_000, now).run();
  if (!lock.meta.changes) return;
  try {
    const { results } = await env.DB.prepare('SELECT * FROM monitors WHERE enabled=1 AND next_check_at<=? ORDER BY next_check_at')
      .bind(now).all<Monitor>();
    const due = results.filter((m) => inWindow(m.active_from, m.active_to, now, env.TIMEZONE)).slice(0, MAX_PER_TICK);
    if (due.length) await checkAndSave(env, due, now);
  } finally {
    await env.DB.prepare('UPDATE tick SET lock_until=0, last_tick=? WHERE id=1').bind(now).run();
  }
}

/** Daily: drop rollups and incidents older than RETENTION_DAYS. */
export function prune(env: Env, now = Date.now()) {
  const days = Number(env.RETENTION_DAYS) || 90;
  return env.DB.batch([
    env.DB.prepare('DELETE FROM stats WHERE monitor_id IN (SELECT id FROM monitors) AND hour < ?').bind(Math.floor(now / HOUR) - days * 24),
    env.DB.prepare('DELETE FROM incidents WHERE started_at < ?').bind(now - days * 86_400_000),
  ]);
}

/** Sends to every configured channel; reports per-channel errors (shown by "Test alert"). */
export async function notify(env: Env, text: string) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = env.TELEGRAM_CHAT_ID?.trim();
  const topic = env.NTFY_TOPIC?.trim();
  const jobs: [string, () => Promise<Response>][] = [];
  if (token && chat)
    jobs.push(['Telegram', () => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, link_preview_options: { is_disabled: true } }),
    })]);
  if (topic) jobs.push(['ntfy', () => fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: text })]);
  const errors: string[] = [];
  await Promise.all(jobs.map(async ([name, send]) => {
    try {
      const res = await send();
      if (!res.ok) errors.push(`${name}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }));
  return { channels: jobs.length, delivered: jobs.length - errors.length, errors };
}
