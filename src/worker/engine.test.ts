import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Monitor } from '../shared/types';
import { checkAndSave } from './engine';

const stmt = { bind: () => stmt };
const env = {
  DB: { prepare: () => stmt, batch: vi.fn() },
  TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1', TIMEZONE: 'Asia/Kolkata',
} as unknown as Env;

const monitor = (over: Partial<Monitor>): Monitor => ({
  id: 1, name: 'API', url: 'https://ok.test/', method: 'GET', interval_min: 10, timeout_sec: 5, expected_status: '200-399',
  keyword: null, active_from: null, active_to: null, fail_threshold: 2, enabled: 1, notify_every: 1, status: 'up', since: 0,
  fails: 0, last_checked_at: null, last_ms: null, last_code: null, last_error: null, next_check_at: 0, created_at: 0, ...over,
});

/** Mocks fetch: monitored URLs answer by hostname, Telegram calls are recorded. */
function mockFetch() {
  const sent: { text: string; disable_notification: boolean }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.includes('api.telegram.org')) { sent.push(JSON.parse(init.body as string)); return new Response('{}'); }
    return new Response('hi', { status: url.includes('ok.test') ? 200 : 503 });
  });
  return sent;
}
afterEach(() => vi.unstubAllGlobals());

describe('checkAndSave notifications', () => {
  it('sends one silent status message for healthy checks', async () => {
    const sent = mockFetch();
    await checkAndSave(env, [monitor({}), monitor({ id: 2, name: 'Web', notify_every: 0 })]);
    expect(sent).toHaveLength(1);
    expect(sent[0].disable_notification).toBe(true);
    expect(sent[0].text).toMatch(/^📊 .*\n🟢 API · \d+ ms$/);
  });

  it('a real DOWN alert is loud and not repeated in the status message', async () => {
    const sent = mockFetch();
    await checkAndSave(env, [monitor({ url: 'https://bad.test/', fails: 1 }), monitor({ id: 2, name: 'Web' })]);
    const loud = sent.find((s) => !s.disable_notification)!;
    const quiet = sent.find((s) => s.disable_notification)!;
    expect(loud.text).toContain('🔴 API is DOWN — HTTP 503');
    expect(quiet.text).toContain('🟢 Web');
    expect(quiet.text).not.toContain('API');
  });

  it('first failure is reported as re-checking', async () => {
    const sent = mockFetch();
    await checkAndSave(env, [monitor({ url: 'https://bad.test/' })]);
    expect(sent[0].text).toContain('🟠 API · HTTP 503 · re-checking in 1 min');
  });
});
