import { Hono } from 'hono';
import { HOUR, type Monitor, type MonitorInput } from '../shared/types';
import { login, logout, requireAuth } from './auth';
import { checkAndSave, notify, prune, tick } from './engine';
import { parseMonitor } from './logic';

const app = new Hono<{ Bindings: Env }>().basePath('/api');

// Public: for an external watchdog (cron-job.org). 503 if the cron hasn't run for 5 min.
app.get('/health', async (c) => {
  const last = (await c.env.DB.prepare('SELECT last_tick FROM tick WHERE id=1').first<number>('last_tick')) ?? 0;
  return c.json({ ok: Date.now() - last < 300_000, last_tick: last }, Date.now() - last < 300_000 ? 200 : 503);
});

app.post('/login', login);
app.post('/logout', logout);

// Everything below requires a session cookie.
app.use('*', requireAuth);

const COLS = ['name', 'url', 'method', 'interval_min', 'timeout_sec', 'expected_status', 'keyword',
  'active_from', 'active_to', 'fail_threshold', 'enabled', 'notify_every'] as const satisfies readonly (keyof MonitorInput)[];
const values = (i: MonitorInput) => COLS.map((k) => i[k]);
const INSERT = `INSERT INTO monitors (${COLS.join()}, created_at) VALUES (${COLS.map(() => '?').join()}, ?) RETURNING *`;
const UPDATE = `UPDATE monitors SET ${COLS.map((k) => `${k}=?`).join()}, next_check_at=0 WHERE id=? RETURNING *`;

const getMonitor = (env: Env, id: string) => env.DB.prepare('SELECT * FROM monitors WHERE id=?').bind(Number(id)).first<Monitor>();

app.get('/monitors', async (c) => {
  const from = Math.floor(Date.now() / HOUR) - 23;
  const [monitors, stats] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM monitors ORDER BY name COLLATE NOCASE'),
    c.env.DB.prepare('SELECT * FROM stats WHERE monitor_id IN (SELECT id FROM monitors) AND hour >= ?').bind(from),
  ]);
  return c.json({ monitors: monitors.results, stats: stats.results });
});

app.post('/monitors', async (c) => {
  const input = parseMonitor(await c.req.json());
  if (typeof input === 'string') return c.text(input, 400);
  const m = await c.env.DB.prepare(INSERT).bind(...values(input), Date.now()).first<Monitor>();
  if (m!.enabled) c.executionCtx.waitUntil(checkAndSave(c.env, [m!])); // first result within seconds
  return c.json(m, 201);
});

app.put('/monitors/:id', async (c) => {
  const input = parseMonitor(await c.req.json());
  if (typeof input === 'string') return c.text(input, 400);
  const m = await c.env.DB.prepare(UPDATE).bind(...values(input), Number(c.req.param('id'))).first<Monitor>();
  return m ? c.json(m) : c.notFound();
});

app.delete('/monitors/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.batch(['monitors WHERE id', 'stats WHERE monitor_id', 'incidents WHERE monitor_id'].map((t) => c.env.DB.prepare(`DELETE FROM ${t}=?`).bind(id)));
  return c.body(null, 204);
});

app.post('/monitors/:id/check', async (c) => {
  const m = await getMonitor(c.env, c.req.param('id'));
  if (!m) return c.notFound();
  await checkAndSave(c.env, [m]);
  return c.json(await getMonitor(c.env, c.req.param('id')));
});

app.get('/monitors/:id/history', async (c) => {
  const id = Number(c.req.param('id'));
  const [stats, incidents] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM stats WHERE monitor_id=? AND hour >= ? ORDER BY hour').bind(id, Math.floor(Date.now() / HOUR) - 30 * 24 + 1),
    c.env.DB.prepare('SELECT * FROM incidents WHERE monitor_id=? ORDER BY started_at DESC LIMIT 20').bind(id),
  ]);
  return c.json({ stats: stats.results, incidents: incidents.results });
});

app.post('/alerts/test', async (c) => c.json(await notify(c.env, '✅ Pulse test alert — notifications work.')));

export default {
  fetch: app.fetch,
  scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === '0 0 * * *' ? prune(env) : tick(env));
  },
} satisfies ExportedHandler<Env>;
