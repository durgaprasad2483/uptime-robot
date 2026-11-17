# Pulse

A personal uptime + keep-alive monitor. It pings your apps on a schedule so free-tier backends (Render, Koyeb, Supabase…) don't fall asleep, and it alerts you on Telegram / ntfy when something goes down.

It runs entirely on Cloudflare's free plan: **₹0, no card, nothing that sleeps.**

| Piece | Used for |
|---|---|
| Cloudflare Worker + Cron Trigger | Runs the checks every minute, serves the API and the dashboard |
| Cloudflare D1 (SQLite) | Monitors, hourly stats, incidents |
| Cloudflare Access | Login: only your email can open the dashboard |
| Hono | API routes (~100 lines) |
| React + Vite + Tailwind | Dashboard (73 KB gzipped, no chart/UI libraries) |
| Telegram / ntfy.sh | Down/up alerts |

## Deploy (one time, ~15 min)

```bash
npm install
npx wrangler login
npx wrangler d1 create pulse          # copy the database_id into wrangler.jsonc
npm run db:remote                     # create tables
npm run deploy                        # prints https://pulse.<you>.workers.dev
```

**1. Lock it down with Cloudflare Access.** Until this is done the API refuses every request, so it's safe by default.
1. Cloudflare dashboard → Workers & Pages → `pulse` → Settings → Domains & Routes → `workers.dev` → **Enable Cloudflare Access**. Then click **Manage Cloudflare Access** and allow only your email.
2. Copy your **team name** (Zero Trust → Settings → team domain `<team>.cloudflareaccess.com`) and the app's **Application Audience (AUD) Tag** (Zero Trust → Access → Applications → your app).
3. Put both into `wrangler.jsonc` → `vars.ACCESS_TEAM` / `vars.ACCESS_AUD`, then run `npm run deploy` again.

**2. Alerts.** Set either one or both.
```bash
# Telegram: create a bot with @BotFather, message it once, then read chat.id from
# https://api.telegram.org/bot<TOKEN>/getUpdates
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
# ntfy: pick a long random topic and subscribe to it in the ntfy app
npx wrangler secret put NTFY_TOPIC
```
Press **Test alert** in the dashboard to confirm.

**3. Watch the watcher (optional, recommended).**
- Zero Trust → Access → Applications → Add → Self-hosted. Domain `pulse.<you>.workers.dev`, path `api/health`, policy action **Bypass** for Everyone.
- On [cron-job.org](https://cron-job.org), create a free job for `https://pulse.<you>.workers.dev/api/health` every 5 min with failure notifications on. `/api/health` returns 503 when the cron hasn't run for 5 minutes.

## Local development

```bash
cp .dev.vars.example .dev.vars        # DEV_NO_AUTH=1 skips Access on localhost only
npm run db:local
npm run dev                           # http://localhost:5173
curl "localhost:5173/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"   # fire the cron by hand
npm test
```

## What to monitor and how often

| Your app | Sleeps after | Preset |
|---|---|---|
| Render free web service | 15 min without traffic | every 10 min, 90 s timeout |
| Koyeb free instance | 1 h without traffic | every 30 min |
| Supabase / Atlas free DB | days without activity | daily. The URL must hit an endpoint that **queries the DB**. |
| Vercel / Netlify / Pages frontend | never | every 5 min, alerts only |

Monitor your **backend's** URL (e.g. `/health`). Static frontends don't sleep; the backend they call does.

**Render warning:** a free workspace has **750 instance-hours/month** shared by all services. One service awake 24/7 uses ~730 h. Keeping two awake suspends all of them mid-month. Use **active hours** (e.g. 08:00–24:00) to stay under the budget; the form shows the estimate. Render designs its free tier to spin down, so keeping services awake is at your own risk.

## How it stays inside the free limits

- **Writes (D1: 100k rows/day)** are the scarce resource. Each check = 2 row writes (monitor state + hourly rollup upsert). Raw check results are never stored. The cron lock and heartbeat add ~2.9k/day. So 20 monitors every 5 min ≈ 14.4k writes/day.
- **No secondary indexes on hot tables**, because each index costs an extra write per check. A scan of a few dozen monitors is cheap on reads (5M/day).
- **One D1 batch per tick** for all results, and **one combined alert message** per tick.
- **≤ 35 checks per tick, 6 at a time**, which fits the 50-subrequest / 6-connection limits. Anything beyond that runs next minute.
- **A one-row lock** stops overlapping ticks when slow (cold-starting) targets take longer than a minute.
- **The dashboard polls once a minute**, only while the tab is visible.
- **The `0 0 * * *` cron** deletes stats/incidents older than `RETENTION_DAYS` (default 90).

## Layout

```
migrations/0001_init.sql   schema
src/shared/types.ts        types shared by worker + dashboard
src/worker/logic.ts        pure logic: status matching, active hours, state machine, validation (+ tests)
src/worker/engine.ts       probe, persist, cron tick, prune, notify
src/worker/index.ts        Hono API + cron entry
src/client/                dashboard
```
