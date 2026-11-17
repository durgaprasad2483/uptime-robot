import { describe, expect, it } from 'vitest';
import { evaluate, inWindow, parseMonitor, statusMatches } from './logic';

describe('statusMatches', () => {
  it('ranges and lists', () => {
    expect(statusMatches(200, '200-399')).toBe(true);
    expect(statusMatches(404, '200-399')).toBe(false);
    expect(statusMatches(204, '200,204')).toBe(true);
    expect(statusMatches(201, '200,204')).toBe(false);
    expect(statusMatches(301, '200-299,301')).toBe(true);
  });
});

describe('inWindow (Asia/Kolkata = UTC+5:30)', () => {
  const at = (utc: string) => Date.parse(`2026-11-17T${utc}:00Z`);
  it('no window = always', () => expect(inWindow(null, null, at('03:00'), 'Asia/Kolkata')).toBe(true));
  it('day window', () => {
    expect(inWindow('08:00', '23:00', at('02:30'), 'Asia/Kolkata')).toBe(true);  // 08:00 IST
    expect(inWindow('08:00', '23:00', at('02:29'), 'Asia/Kolkata')).toBe(false); // 07:59 IST
    expect(inWindow('08:00', '23:00', at('17:30'), 'Asia/Kolkata')).toBe(false); // 23:00 IST (exclusive)
  });
  it('overnight window', () => {
    expect(inWindow('22:00', '06:00', at('18:30'), 'Asia/Kolkata')).toBe(true);  // 00:00 IST
    expect(inWindow('22:00', '06:00', at('06:30'), 'Asia/Kolkata')).toBe(false); // 12:00 IST
  });
});

describe('evaluate', () => {
  const base = { status: 'up' as const, fails: 0, fail_threshold: 2, interval_min: 10 };
  const t = 1_000_000;
  it('single failure is not down yet, re-checks in 1 min', () => {
    const r = evaluate(base, false, t);
    expect(r).toMatchObject({ status: 'up', fails: 1, alert: false, next: t + 30_000 });
  });
  it('threshold reached → down + alert', () => {
    expect(evaluate({ ...base, fails: 1 }, false, t)).toMatchObject({ status: 'down', alert: true, next: t + 570_000 });
  });
  it('still down → no repeat alert', () => {
    expect(evaluate({ ...base, status: 'down', fails: 5 }, false, t)).toMatchObject({ status: 'down', alert: false });
  });
  it('recovery → up + alert, fails reset', () => {
    expect(evaluate({ ...base, status: 'down', fails: 5 }, true, t)).toMatchObject({ status: 'up', fails: 0, alert: true });
  });
  it('new monitor coming up is silent; new monitor down alerts', () => {
    expect(evaluate({ ...base, status: 'pending' }, true, t).alert).toBe(false);
    expect(evaluate({ ...base, status: 'pending', fail_threshold: 1 }, false, t)).toMatchObject({ status: 'down', alert: true });
  });
});

describe('parseMonitor', () => {
  const ok = { name: ' API ', url: 'https://x.onrender.com/health', method: 'GET', interval_min: 10, timeout_sec: 90, expected_status: '200-399', fail_threshold: 2 };
  it('accepts and normalizes', () => {
    expect(parseMonitor(ok)).toMatchObject({ name: 'API', keyword: null, active_from: null, enabled: 1, notify_every: 1 });
    expect(parseMonitor({ ...ok, notify_every: 0 })).toMatchObject({ notify_every: 0 });
  });
  it('rejects bad input', () => {
    expect(parseMonitor({ ...ok, url: 'ftp://x' })).toBeTypeOf('string');
    expect(parseMonitor({ ...ok, interval_min: 0 })).toBeTypeOf('string');
    expect(parseMonitor({ ...ok, expected_status: '2xx' })).toBeTypeOf('string');
    expect(parseMonitor({ ...ok, active_from: '08:00' })).toBeTypeOf('string');
    expect(parseMonitor({ ...ok, method: 'HEAD', keyword: 'ok' })).toBeTypeOf('string');
  });
});
