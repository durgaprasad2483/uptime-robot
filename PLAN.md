# Personal Keep-Alive Monitor: Stack & Build Plan (₹0 forever)

> Scope: **personal use only**. Keep my own apps awake and tell me when they go down.
> Research date: 2026-11-17. Replaces the earlier open-source/MongoDB plan.

---

## 1. The decision in one line

**Everything runs inside one Cloudflare Worker:** cron scheduler + API + dashboard. Data goes in **Cloudflare D1** (SQLite), login is handled by **Cloudflare Access**, and alerts go to **Telegram / ntfy**.
One account, one deploy command, no servers, nothing that can fall asleep, and no card on file.

### Why D1 instead of MongoDB
| | MongoDB Atlas M0 | **Cloudflare D1** ✅ |
|---|---|---|
| How the Worker connects | TCP driver over the internet, ~300 ms cold connect, auth CPU cost | **Built-in binding**, no connection, no driver, no secrets |
| Risk with the 10 ms free CPU limit | **High**: the driver + SCRAM auth can blow it | **None**: queries run outside your Worker's CPU |
| Free limits | 512 MB, 100 ops/s | **5 GB**, 5M rows read/day, 100k rows written/day |
| Goes to sleep | Pauses after 30 days without connections | Never |
| Extra account | Yes | No, same Cloudflare account |
| Changing the schema | Free-form | SQL migrations (Drizzle generates them for you) |

MongoDB would have been the one weak spot. With D1 the whole system lives on a single platform that doesn't sleep.

---

## 2. The complete tech stack: what each piece is, what you do with it, why it helps

### 2.1 Runtime & hosting
| Tech | What it is | What you'll do with it | Why it's useful here | Free limit |
|---|---|---|---|---|
| **Cloudflare Workers** | Serverless functions on Cloudflare's edge | Host the whole app: API routes, cron handler, dashboard files | Doesn't sleep. **Cron Triggers run every minute on the free plan** (Vercel Hobby: once/day, Render free: sleeps itself) | 100k requests/day, 5 cron triggers, 10 ms CPU/run (network wait doesn't count), 50 outbound fetches/run |
| **Cron Triggers** | Built-in scheduler for Workers | `"crons": ["* * * * *"]` wakes the Worker every minute to check whatever is due | This is the "uptime robot" engine, and it's free | 5 per account (we need 1) |
| **Workers Static Assets** | Serves your built frontend from the same Worker | Serves the React dashboard at `/`, API at `/api/*` | One deploy, one URL, no separate Pages project | Static asset requests are free and unlimited |
| **Cloudflare D1** | Managed SQLite database | Store monitors, check results, incidents, settings | Native binding, nothing to connect, never pauses | 5 GB, 5M reads/day, 100k writes/day |
| **Cloudflare Access** (Zero Trust free) | Login wall in front of your app | Turn on with one click: Worker → Settings → Domains & Routes → **Enable Cloudflare Access** → allow only your email | **No auth code to write.** You log in with an email OTP or Google. Only you can open the dashboard. | Free for up to 50 users (you need 1) |
| **workers.dev subdomain** | Free URL, e.g. `pulse.<you>.workers.dev` | Your dashboard address | No domain purchase needed | Free |

### 2.2 Backend code
| Tech | What it is | What you'll do with it | Why it's useful |
|---|---|---|---|
| **TypeScript** | Typed JavaScript | Write all the code | Catches bugs before deploy. Types are shared between frontend and backend. |
| **Hono** | Tiny web framework built for Workers | Define `/api/monitors`, `/api/stats` and other routes | Express-like and very fast. Has helpers for Cloudflare bindings and validation. |
| **Drizzle ORM** + **drizzle-kit** | Type-safe SQL toolkit with first-class D1 support | Define tables in TS, generate SQL migrations, write typed queries | Autocomplete on every column. Schema changes become simple migrations. |
| **Zod** | Schema validation | Validate the "create monitor" form on both client and server | Bad input (e.g. an invalid URL) never reaches the DB |
| **Wrangler** | Cloudflare's CLI | `wrangler dev`, `wrangler d1 migrations apply`, `wrangler deploy`, `wrangler tail` (live logs) | The only tool you need to run, migrate and ship |

### 2.3 Frontend
| Tech | What it is | What you'll do with it | Why it's useful |
|---|---|---|---|
| **React 19 + Vite** | UI library + fast build tool | Build the dashboard | Fast hot reload. Standard and well documented. |
| **@cloudflare/vite-plugin** | Runs your Worker inside Vite's dev server | `npm run dev` starts frontend + API + D1 together | One command, the real Workers runtime locally |
| **Tailwind CSS v4** | Utility CSS | Style everything | No CSS files to manage |
| **shadcn/ui** | Copy-paste components (built on Radix) | Tables, dialogs, forms, badges, toasts | Looks professional with almost no design work |
| **TanStack Query** | Data fetching/caching | Load monitors, auto-refresh the dashboard every 30 s | Handles loading/error states and refetching for you |
| **Recharts** (or uPlot) | Charts | Response-time line chart, uptime bars | Quick to set up for a handful of monitors |

### 2.4 Alerts (all free)
| Tech | What you'll do with it | Why |
|---|---|---|
| **Telegram Bot API** ⭐ | Create a bot with @BotFather, get a chat id, POST to `sendMessage` | Instant phone notification, free, no limits that matter |
| **ntfy.sh** | POST to `https://ntfy.sh/<secret-topic>`, install the ntfy app | Push notifications with zero signup |
| **Discord webhook** (optional) | POST JSON to a channel webhook | If you live in Discord |
| **Resend** (optional) | Email alerts via HTTP API | Free 3,000 emails/month |

### 2.5 Development & safety net
| Tech | What you'll do with it | Why |
|---|---|---|
| **Node.js 22 LTS + pnpm** | Install deps, run scripts | Fast, saves disk |
| **Git + GitHub (private repo)** | Version control, backup of code | Free private repos |
| **GitHub Actions** (optional) | Auto `wrangler deploy` on push to `main` | Push code and it's live. 2,000 free minutes/month on private repos. |
| **Vitest + @cloudflare/vitest-pool-workers** | Test the checker and scheduler in the real Workers runtime | Confidence that alerts actually fire |
| **Biome** | Lint + format | One tool instead of ESLint + Prettier |
| **cron-job.org** (free) | Ping your Worker's `/api/health` every 5 min, with email on failure | **Watches the watcher.** If your monitor itself breaks, you still find out. |

**Total monthly cost: ₹0.** No credit card required anywhere above.

---

## 3. Architecture

```
                 every minute
 Cloudflare Cron ─────────────┐
                              ▼
 ┌───────────── Cloudflare Worker "pulse" ─────────────┐
 │ scheduled():  runTick()                              │
 │   1. SELECT monitors WHERE due        ──► D1         │
 │   2. fetch() each URL (6 at a time)   ──► your apps  │
 │   3. write results + update state     ──► D1         │
 │   4. if UP↔DOWN changed → alert       ──► Telegram   │
 │                                                      │
 │ fetch():  /api/*  → Hono routes       ◄─► D1         │
 │           /*      → React dashboard (static assets)  │
 └──────────────────────────────────────────────────────┘
          ▲  guarded by Cloudflare Access (only your email)
          │
        You (browser / phone)

 cron-job.org ──► /api/health every 5 min (emails you if the Worker is dead)
```

---

## 4. Keep-alive reality check (important)

| Where your app lives | Does it sleep? | What to do |
|---|---|---|
| Vercel / Netlify / Cloudflare Pages **frontends** | **No.** Static/edge frontends never sleep. | Monitor only for downtime alerts (e.g. every 10 min) |
| **Render free** web service (backend) | Sleeps after **15 min** without traffic, ~1 min cold start | Ping every **10 min**, timeout 90 s |
| **Koyeb free** instance | Scales to zero after **1 h** without traffic (can't be disabled) | Ping every **30–50 min** |
| **Supabase free** | Project pauses after **7 days** without DB activity | Ping **daily** an endpoint that **actually queries the DB** |
| **MongoDB Atlas M0** | Pauses after **30 days** with zero connections | Ping **daily** an endpoint that touches the DB |
| **Neon free** Postgres | Scales to zero after ~5 min, wakes in under a second | **Don't** keep it awake (it burns your compute hours). The cold start is barely noticeable. |

The most likely reason your frontend feels slow is a **sleeping backend** it calls. Monitor the backend's `/health` URL, not the frontend.

### ⚠️ Render: two things to know
1. **Hours budget:** 750 free instance-hours per workspace per month. One service awake 24/7 uses ~730 h. **Two services awake 24/7 exhaust the budget mid-month, and then Render suspends all your free services.** Fix: use **active hours** (e.g. ping only 08:00–24:00 IST, which uses ~496 h per service), or keep each always-on service in a separate workspace.
2. **Policy risk:** Render's free tier is designed to spin down. A reply on Render's community forum reportedly calls artificially keeping free services awake "abuse". I couldn't open the post to confirm, and the official docs don't forbid it. Read Render's current Terms and use **active hours** rather than 24/7 to stay reasonable. Koyeb's docs simply say free instances sleep after 1 h of no traffic.

This is why the app has a per-monitor **active hours** window (built in Phase 3).

---

## 5. Database schema (D1 via Drizzle)

```ts
// src/worker/db/schema.ts
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const monitors = sqliteTable('monitors', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  name:             text('name').notNull(),
  url:              text('url').notNull(),
  method:           text('method', { enum: ['GET', 'HEAD', 'POST'] }).notNull().default('GET'),
  intervalMin:      integer('interval_min').notNull().default(10),  // 1,5,10,15,30,60,1440
  timeoutSec:       integer('timeout_sec').notNull().default(90),   // cold starts are slow
  expectedStatus:   text('expected_status').notNull().default('200-399'),
  keyword:          text('keyword'),                                // optional "body must contain"
  activeFrom:       text('active_from'),                            // "08:00" (IST) or null = 24/7
  activeTo:         text('active_to'),                              // "23:59"
  failThreshold:    integer('fail_threshold').notNull().default(2),
  enabled:          integer('enabled', { mode: 'boolean' }).notNull().default(true),
  // live state
  status:           text('status', { enum: ['pending', 'up', 'down'] }).notNull().default('pending'),
  consecutiveFails: integer('consecutive_fails').notNull().default(0),
  lastCheckedAt:    integer('last_checked_at'),                     // unix ms
  lastResponseMs:   integer('last_response_ms'),
  lastStatusCode:   integer('last_status_code'),
  lastError:        text('last_error'),
  nextCheckAt:      integer('next_check_at').notNull().default(0),
  createdAt:        integer('created_at').notNull(),
});

// One B-tree only (composite PK, no extra index), so each insert = 1 row written
export const checks = sqliteTable('checks', {
  monitorId:  integer('monitor_id').notNull(),
  ts:         integer('ts').notNull(),
  ok:         integer('ok', { mode: 'boolean' }).notNull(),
  statusCode: integer('status_code'),
  responseMs: integer('response_ms'),
  error:      text('error'),
}, t => [primaryKey({ columns: [t.monitorId, t.ts] })]);

export const incidents = sqliteTable('incidents', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  monitorId:  integer('monitor_id').notNull(),
  startedAt:  integer('started_at').notNull(),
  resolvedAt: integer('resolved_at'),
  cause:      text('cause'),
});
```

**Why there's no index on `monitors.next_check_at`:** with ~20 monitors, a full scan is 20 rows read per minute (~29k/day of the 5M budget), and every update would otherwise cost an extra indexed row write. Writes are the scarce resource on D1 (100k/day). Reads are plentiful.

### Write budget (the one limit to respect)
Each check costs about **2 rows written**: 1 insert into `checks` + 1 update on `monitors`.

| Setup | Checks/day | Rows written/day | OK? |
|---|---|---|---|
| 10 monitors @ 10 min | 1,440 | ~2,900 | ✅ 3% |
| 20 monitors @ 5 min | 5,760 | ~11,500 | ✅ 12% |
| 30 monitors @ 1 min | 43,200 | ~86,400 | ⚠️ 86%, too close |

**Rule:** keep total checks/day under ~40k. The dashboard should show "estimated rows written/day" as you add monitors.
**Retention:** 5 GB of storage is enough for years at personal scale (~60 bytes/check). Delete old checks once a day **in small batches** (e.g. keep 30 days), because deletes also count as writes.

---

## 6. Core code (the heart)

### 6.1 Worker entry
```ts
// src/worker/index.ts
import { Hono } from 'hono';
import { api } from './routes';
import { runTick } from './tick';

const app = new Hono<{ Bindings: Env }>();
app.route('/api', api);

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runTick(env));
  },
} satisfies ExportedHandler<Env>;
```

### 6.2 The tick
```ts
// src/worker/tick.ts
export async function runTick(env: Env) {
  const db = drizzle(env.DB);
  const now = Date.now();

  const due = (await db.select().from(monitors)
    .where(and(eq(monitors.enabled, true), lte(monitors.nextCheckAt, now))))
    .filter(m => inActiveWindow(m, now, 'Asia/Kolkata'))
    .slice(0, 40);                                 // stay under 50 subrequests/run

  const results = await pLimit(6, due, checkMonitor); // 6 = CF connection limit

  const stmts = [];
  const alerts = [];
  for (const [m, r] of zip(due, results)) {
    const fails = r.ok ? 0 : m.consecutiveFails + 1;
    const newStatus = r.ok ? 'up' : fails >= m.failThreshold ? 'down' : m.status;
    if (newStatus !== m.status && m.status !== 'pending') alerts.push({ m, r, newStatus });
    // when failing, re-check in 1 min to confirm quickly
    const next = now + (r.ok || newStatus === 'down' ? m.intervalMin : 1) * 60_000;

    stmts.push(db.insert(checks).values({ monitorId: m.id, ts: now, ...r }));
    stmts.push(db.update(monitors).set({
      status: newStatus, consecutiveFails: fails, lastCheckedAt: now,
      lastResponseMs: r.responseMs, lastStatusCode: r.statusCode, lastError: r.error,
      nextCheckAt: next,
    }).where(eq(monitors.id, m.id)));
  }
  if (stmts.length) await db.batch(stmts);        // ONE round trip for everything

  await Promise.all(alerts.map(a => notify(env, a)));  // Telegram / ntfy
}
```

### 6.3 One check
```ts
export async function checkMonitor(m: Monitor) {
  const t0 = Date.now();
  try {
    const res = await fetch(m.url, {
      method: m.method,
      headers: { 'User-Agent': 'PulseKeepAlive/1.0 (personal)' },
      signal: AbortSignal.timeout(m.timeoutSec * 1000),
      cf: { cacheTtl: 0 },                     // never let Cloudflare's cache answer
    });
    const responseMs = Date.now() - t0;
    let ok = statusMatches(res.status, m.expectedStatus);
    if (ok && m.keyword) ok = (await res.text()).includes(m.keyword);
    else await res.body?.cancel();
    return { ok, statusCode: res.status, responseMs, error: null };
  } catch (e: any) {
    return { ok: false, statusCode: null, responseMs: Date.now() - t0,
             error: e?.name === 'TimeoutError' ? 'timeout' : String(e?.message ?? e) };
  }
}
```

### 6.4 Telegram alert
```ts
await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    chat_id: env.TELEGRAM_CHAT_ID,
    text: `${newStatus === 'down' ? '🔴 DOWN' : '🟢 UP'}: ${m.name}\n${m.url}\n${r.error ?? r.statusCode}`,
  }),
});
```

### 6.5 `wrangler.jsonc`
```jsonc
{
  "name": "pulse",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-11-01",
  "assets": { "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
  "triggers": { "crons": ["* * * * *"] },
  "d1_databases": [{ "binding": "DB", "database_name": "pulse", "database_id": "<from wrangler d1 create>", "migrations_dir": "drizzle" }],
  "observability": { "enabled": true }
}
```
Secrets (never in git): `wrangler secret put TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HEALTH_TOKEN`.

---

## 7. API routes
```
GET    /api/health                 public, for cron-job.org (returns last tick time; 500 if no tick in 5 min)
GET    /api/monitors               list + live status
POST   /api/monitors               create (zod)
PATCH  /api/monitors/:id           edit / pause / resume
DELETE /api/monitors/:id
POST   /api/monitors/:id/check     "check now" button
GET    /api/monitors/:id/checks?hours=24   response-time chart data
GET    /api/monitors/:id/uptime?days=30    uptime % (SQL aggregate)
GET    /api/incidents
POST   /api/alerts/test            send a test Telegram message
```
Everything except `/api/health` is behind Cloudflare Access. In the Access app, add a **bypass policy** for `/api/health`. As a second layer, the Worker checks the `Cf-Access-Jwt-Assertion` header on all other routes.

## 8. Dashboard screens
1. **Overview:** a card per monitor: name, 🟢/🔴, last response time, 24 h sparkline, uptime %, next check in.
2. **Add/Edit monitor:** URL, interval, **preset dropdown** (Render 10 min / Koyeb 30 min / Supabase daily / Frontend 10 min) that fills interval + timeout, active hours, keyword, expected status.
3. **Monitor detail:** response-time chart, incident list, "Check now".
4. **Settings:** test alert, D1 usage estimate (rows written/day), Render hours estimator.

---

## 9. Step-by-step procedure

### Step 0: Accounts (10 min, all free, no card)
1. Cloudflare account → note your `workers.dev` subdomain.
2. GitHub account → create a private repo `pulse`.
3. Telegram → talk to **@BotFather** → `/newbot` → copy the token. Send your bot a message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` to read your `chat.id`.
4. cron-job.org account (do this in Step 6).

### Step 1: Scaffold (30 min)
```bash
npm create cloudflare@latest pulse -- --framework=react   # React + Vite + Worker + vite plugin
cd pulse
pnpm add hono drizzle-orm zod @hono/zod-validator @tanstack/react-query recharts
pnpm add -D drizzle-kit @cloudflare/vitest-pool-workers vitest @biomejs/biome
pnpm dlx shadcn@latest init           # sets up Tailwind v4 + shadcn
npx wrangler d1 create pulse          # paste database_id into wrangler.jsonc
npx wrangler types                    # generates the Env type with DB binding
```

### Step 2: Database (1 h)
- Write `schema.ts` (§5), then: `npx drizzle-kit generate` → `npx wrangler d1 migrations apply pulse --local`.

### Step 3: Engine (1 day)
- `checkMonitor`, `runTick`, `notify`, active-hours helper (IST).
- Test locally: `npx wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to fire the cron by hand.
- Vitest tests: status-range matching, threshold logic (1 fail ≠ down, 2 fails = down), UP↔DOWN alert only once.

### Step 4: API (½ day)
- Hono routes (§7) with zod validation.

### Step 5: Dashboard (2–3 days)
- Screens from §8 with shadcn Card/Table/Dialog/Form + TanStack Query (`refetchInterval: 30_000`).

### Step 6: Deploy & lock down (1 h)
```bash
npx wrangler d1 migrations apply pulse --remote
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
pnpm run deploy                         # vite build + wrangler deploy
```
1. Dashboard → Workers → `pulse` → Settings → Domains & Routes → **Enable Cloudflare Access** → manage → allow only your email.
2. Add a bypass for `/api/health`.
3. cron-job.org → new job → `https://pulse.<you>.workers.dev/api/health` every 5 min → enable "notify on failure" emails.
4. Add your real monitors. Use the Render preset for backends.

### Step 7: Automate (optional, 30 min)
- GitHub Actions workflow: on push to `main` → `pnpm i && pnpm test && pnpm run deploy` using a `CLOUDFLARE_API_TOKEN` repo secret.

### Step 8: Live with it
- `npx wrangler tail` for live logs. The Workers dashboard shows cron runs, CPU and errors.
- After a week, check D1 usage in the Cloudflare dashboard against §5's budget.

**Realistic total: ~1 week of evenings.**

---

## 10. Things that go wrong, and the fix
| Problem | Fix |
|---|---|
| Render app shows "down" on the first ping after sleep | Timeout 90 s + fail threshold 2 (already the defaults) |
| Monitored app is behind Cloudflare and blocks bots | Add a `/health` route on your app. Allow the `PulseKeepAlive` User-Agent. |
| D1 write limit hit (queries fail until 00:00 UTC = 05:30 IST) | Raise intervals. The settings page shows the estimate. |
| Cron stopped / Worker broke | cron-job.org emails you because `/api/health` reports a stale last tick |
| You want sub-minute checks | Not needed for keep-alive. Possible later with Durable Object alarms. |

---

## 11. Sources
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- D1 pricing/limits: https://developers.cloudflare.com/d1/platform/pricing/
- One-click Access for Workers: https://developers.cloudflare.com/changelog/2025-10-03-one-click-access-for-workers
- Vercel cron limits (Hobby = daily): https://vercel.com/docs/cron-jobs/usage-and-pricing
- Render free tier: https://render.com/docs/free
- Koyeb scale-to-zero: https://www.koyeb.com/docs/run-and-scale/scale-to-zero
- Atlas M0 limits: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
- Cloudflare Zero Trust free plan: https://www.cloudflare.com/plans/sase-zero-trust.md
